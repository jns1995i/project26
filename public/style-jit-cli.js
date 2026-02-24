#!/usr/bin/env node

/**
 * style-jit-cli.js
 * ─────────────────────────────────────────────────────
 * Tailwind-style JIT build tool for your custom style.css
 * 
 * Usage:
 *   node style-jit-cli.js --css style.css --scan "src/**" --out output.css
 * 
 * Options:
 *   --css    Path to your full style.css (required)
 *   --scan   Glob pattern(s) of files to scan for class names (required)
 *            Can be repeated: --scan "src/x.html" --scan "src/y.js"
 *   --out    Output file path (default: style.jit.css)
 *   --watch  Watch for changes and rebuild automatically
 *   --stats  Show stats after build
 */

const fs = require('fs');
const path = require('path');

// ─── Arg Parsing ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(name, fallback = null) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : fallback;
}

function getAllArgs(name) {
  const results = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === `--${name}` && args[i + 1]) {
      results.push(args[i + 1]);
      i++;
    }
  }
  return results;
}

const cssPath    = getArg('css');
const outPath    = getArg('out', 'style.jit.css');
const watchMode  = args.includes('--watch');
const showStats  = args.includes('--stats');
const scanGlobs  = getAllArgs('scan');

if (!cssPath) {
  console.error('❌ Missing --css argument. Usage: node style-jit-cli.js --css style.css --scan "**/*.html" --out output.css');
  process.exit(1);
}
if (scanGlobs.length === 0) {
  console.error('❌ Missing --scan argument. Provide at least one glob like --scan "src/**/*.html"');
  process.exit(1);
}

// ─── File Scanner ─────────────────────────────────────────────────────────────

function expandGlob(pattern) {
  // Simple glob expander (no external deps needed for common patterns)
  // Supports: **/*.ext, *.ext, dir/**/*.ext
  const { execSync } = require('child_process');
  try {
    const result = execSync(`find . -type f -name "${pattern.split('/').pop()}" 2>/dev/null | head -500`, { encoding: 'utf8' });
    return result.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function scanFilesForClasses(globs) {
  const usedClasses = new Set();
  const classPattern = /[a-zA-Z][a-zA-Z0-9_-]*/g;

  for (const glob of globs) {
    let files = [];

    if (!glob.includes('*')) {
      // Direct path
      if (fs.existsSync(glob)) files = [glob];
    } else {
      // Use find for glob matching
      const { execSync } = require('child_process');
      const ext = glob.split('.').pop();
      const dir = glob.includes('/') ? glob.split('/**')[0] : '.';
      try {
        const out = execSync(`find ${dir} -type f -name "*.${ext}" 2>/dev/null`, { encoding: 'utf8' });
        files = out.trim().split('\n').filter(Boolean);
      } catch {}
    }

    for (const file of files) {
      if (!fs.existsSync(file)) continue;
      const content = fs.readFileSync(file, 'utf8');

      // Extract class names from class="..." or className="..."
      const classAttrPattern = /class(?:Name)?=["'`]([^"'`]+)["'`]/g;
      let match;
      while ((match = classAttrPattern.exec(content)) !== null) {
        match[1].split(/\s+/).forEach(c => c && usedClasses.add(c.trim()));
      }

      // Also scan for classList.add/toggle/contains patterns
      const classListPattern = /classList\.(?:add|toggle|contains|replace|remove)\(["'`]([^"'`]+)["'`]/g;
      while ((match = classListPattern.exec(content)) !== null) {
        match[1].split(/\s+/).forEach(c => c && usedClasses.add(c.trim()));
      }

      // Scan template literals with class usage
      const templatePattern = /`[^`]*class[^`]*`/g;
      while ((match = templatePattern.exec(content)) !== null) {
        const inner = match[0];
        const words = inner.match(classPattern) || [];
        words.forEach(w => usedClasses.add(w));
      }
    }
  }

  return usedClasses;
}

// ─── CSS Parser ───────────────────────────────────────────────────────────────

function parseCSSRules(cssText) {
  /**
   * Returns an array of rule objects:
   * { type: 'rule'|'at-rule'|'comment', selector, body, raw }
   */
  const rules = [];

  // Extract @imports and @charset first (keep them always)
  const importPattern = /^@import\s+[^;]+;/gm;
  let match;
  while ((match = importPattern.exec(cssText)) !== null) {
    rules.push({ type: 'import', raw: match[0] });
  }

  // Extract :root block (keep always)
  const rootMatch = cssText.match(/:root\s*\{[^}]*(?:\{[^}]*\}[^}]*)?\}/s);
  if (rootMatch) {
    rules.push({ type: 'root', raw: rootMatch[0] });
  }

  // Extract base element rules (no class selectors)
  const baseElements = ['*', 'html', 'body', 'div', 'section', 'main', 'p', 'hr',
    'form', 'input', 'select', 'textarea', 'label', 'fieldset', 'option',
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'button', 'i', 'img',
    'progress', '::-webkit-scrollbar', '::-webkit-scrollbar-thumb',
    '::-webkit-scrollbar-track', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'span', 'nav', 'header', 'footer', 'aside'
  ];

  return { imports: rules, cssText };
}

// ─── Main Build Function ───────────────────────────────────────────────────────

function build() {
  console.log('\n🔨 Building...');

  if (!fs.existsSync(cssPath)) {
    console.error(`❌ CSS file not found: ${cssPath}`);
    process.exit(1);
  }

  const startTime = Date.now();
  const fullCSS = fs.readFileSync(cssPath, 'utf8');
  const usedClasses = scanFilesForClasses(scanGlobs);

  console.log(`   📋 Found ${usedClasses.size} unique class names in your files`);

  // Split CSS into blocks using a careful state machine
  const outputBlocks = [];
  let i = 0;
  let inComment = false;
  const len = fullCSS.length;

  // Always keep: @import, :root, base element styles, @media
  // Only filter: .className rules

  // Strategy: extract the file in logical blocks
  // Blocks = @import lines, :root{}, base styles, .class{}, @media{}

  function extractBlock(startIdx) {
    // Find the matching closing brace for a block starting at startIdx
    let depth = 0;
    let j = startIdx;
    while (j < len) {
      if (fullCSS[j] === '{') depth++;
      else if (fullCSS[j] === '}') {
        depth--;
        if (depth === 0) return j;
      }
      j++;
    }
    return j;
  }

  // Tokenize the CSS into segments
  const segments = [];
  let pos = 0;

  while (pos < len) {
    // Skip whitespace
    const wsStart = pos;
    while (pos < len && /\s/.test(fullCSS[pos])) pos++;

    if (pos >= len) break;

    // Comment
    if (fullCSS.startsWith('/*', pos)) {
      const end = fullCSS.indexOf('*/', pos + 2);
      const endPos = end === -1 ? len : end + 2;
      segments.push({ type: 'comment', raw: fullCSS.slice(pos, endPos) });
      pos = endPos;
      continue;
    }

    // @import line
    if (fullCSS.startsWith('@import', pos)) {
      const end = fullCSS.indexOf(';', pos);
      const endPos = end === -1 ? len : end + 1;
      segments.push({ type: 'import', raw: fullCSS.slice(pos, endPos) });
      pos = endPos;
      continue;
    }

    // @media or other @-rules
    if (fullCSS[pos] === '@') {
      const braceStart = fullCSS.indexOf('{', pos);
      if (braceStart === -1) { pos = len; continue; }
      const braceEnd = extractBlock(braceStart);
      segments.push({ type: 'at-rule', raw: fullCSS.slice(pos, braceEnd + 1) });
      pos = braceEnd + 1;
      continue;
    }

    // Find selector end (opening brace)
    const braceStart = fullCSS.indexOf('{', pos);
    if (braceStart === -1) { pos = len; continue; }

    const selector = fullCSS.slice(pos, braceStart).trim();
    const braceEnd = extractBlock(braceStart);
    const raw = fullCSS.slice(pos, braceEnd + 1);

    segments.push({ type: 'rule', selector, raw });
    pos = braceEnd + 1;
  }

  // Now filter segments
  const baseElementSelectors = [
    /^\*$/, /^html$/, /^body$/, /^div$/, /^section$/, /^main$/,
    /^p$/, /^hr$/, /^form$/, /^input/, /^select$/, /^textarea$/,
    /^label$/, /^fieldset$/, /^option$/, /^table$/, /^thead$/,
    /^tbody$/, /^tr$/, /^th$/, /^td$/, /^a$/, /^button$/,
    /^a,\s*button$/, /^i$/, /^img$/, /^progress/, /^::-webkit/,
    /^::/, /^:root/, /^h[1-6]$/, /^ul$/, /^ol$/, /^li$/,
    /^span$/, /^nav$/, /^p\s+i/, /^i\.material/, /^td\s+img/,
    /^tr:nth/, /^#pagination/, /^input\[type/, /^textarea:focus/
  ];

  function isBaseElement(selector) {
    return baseElementSelectors.some(re => re.test(selector));
  }

  function selectorUsesClass(selector, usedClasses) {
    // Extract class names from selector like .foo, .bar.baz, .foo:hover
    const classNames = selector.match(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g);
    if (!classNames) return false; // no class in selector
    // Keep if ANY class in this selector is used
    return classNames.some(cn => usedClasses.has(cn.slice(1)));
  }

  function shouldKeepSegment(seg) {
    if (seg.type === 'import') return true;
    if (seg.type === 'comment') return true; // keep section comments
    if (seg.type === 'at-rule') {
      // For @media, filter internal rules too
      if (seg.raw.startsWith('@media') || seg.raw.startsWith('@keyframe')) return true;
      return true;
    }
    if (seg.type === 'rule') {
      if (isBaseElement(seg.selector)) return true;
      // Keep if selector contains a used class
      return selectorUsesClass(seg.selector, usedClasses);
    }
    return false;
  }

  // Filter @media blocks internally too
  function filterMediaBlock(raw) {
    // Find the outer braces
    const firstBrace = raw.indexOf('{');
    if (firstBrace === -1) return raw;
    const header = raw.slice(0, firstBrace + 1);
    const inner = raw.slice(firstBrace + 1, -1); // strip outer {}

    // Re-parse inner rules of the media block
    const innerRules = [];
    let p = 0;
    const innerLen = inner.length;

    while (p < innerLen) {
      while (p < innerLen && /\s/.test(inner[p])) p++;
      if (p >= innerLen) break;

      if (inner.startsWith('/*', p)) {
        const end = inner.indexOf('*/', p + 2);
        p = end === -1 ? innerLen : end + 2;
        continue;
      }

      const braceStart = inner.indexOf('{', p);
      if (braceStart === -1) { p = innerLen; continue; }

      const selector = inner.slice(p, braceStart).trim();

      // Find matching brace
      let depth = 0, q = braceStart;
      while (q < innerLen) {
        if (inner[q] === '{') depth++;
        else if (inner[q] === '}') { depth--; if (depth === 0) break; }
        q++;
      }
      const ruleRaw = inner.slice(p, q + 1);

      if (isBaseElement(selector) || selectorUsesClass(selector, usedClasses)) {
        innerRules.push(ruleRaw);
      }

      p = q + 1;
    }

    if (innerRules.length === 0) return null;
    return `${header}\n${innerRules.join('\n')}\n}`;
  }

  const keptRules = [];
  let keptCount = 0;
  let skippedCount = 0;

  for (const seg of segments) {
    if (seg.type === 'at-rule' && seg.raw.startsWith('@media')) {
      const filtered = filterMediaBlock(seg.raw);
      if (filtered) {
        keptRules.push(filtered);
        keptCount++;
      } else {
        skippedCount++;
      }
    } else if (shouldKeepSegment(seg)) {
      keptRules.push(seg.raw);
      keptCount++;
    } else {
      skippedCount++;
    }
  }

  const output = keptRules.join('\n\n');
  fs.writeFileSync(outPath, output, 'utf8');

  const originalSize = (Buffer.byteLength(fullCSS) / 1024).toFixed(1);
  const outputSize   = (Buffer.byteLength(output) / 1024).toFixed(1);
  const reduction    = (100 - (outputSize / originalSize) * 100).toFixed(1);
  const elapsed      = Date.now() - startTime;

  console.log(`\n✅ Done in ${elapsed}ms`);
  console.log(`   📦 Input:  ${originalSize} KB (${segments.filter(s=>s.type==='rule').length} rules)`);
  console.log(`   📤 Output: ${outputSize} KB → ${reduction}% smaller`);
  console.log(`   💾 Saved to: ${outPath}`);

  if (showStats) {
    console.log(`\n📊 Stats:`);
    console.log(`   Used classes detected: ${usedClasses.size}`);
    console.log(`   Rules kept: ${keptCount}`);
    console.log(`   Rules pruned: ${skippedCount}`);
    console.log(`\n   Used classes:`);
    [...usedClasses].sort().forEach(c => console.log(`     .${c}`));
  }
}

// ─── Watch Mode ───────────────────────────────────────────────────────────────

build();

if (watchMode) {
  console.log('\n👁  Watching for file changes... (Ctrl+C to stop)\n');

  const watchTargets = scanGlobs.map(g => {
    if (!g.includes('*')) return g;
    return g.split('/**')[0] || '.';
  });

  const uniqueWatchTargets = [...new Set(watchTargets)];

  uniqueWatchTargets.forEach(dir => {
    if (fs.existsSync(dir)) {
      fs.watch(dir, { recursive: true }, (event, filename) => {
        if (filename && (filename.endsWith('.html') || filename.endsWith('.js') || filename.endsWith('.jsx') || filename.endsWith('.vue') || filename.endsWith('.php'))) {
          console.log(`\n♻️  Change detected in ${filename}`);
          build();
        }
      });
    }
  });

  // Also watch the CSS source itself
  if (fs.existsSync(cssPath)) {
    fs.watch(cssPath, () => {
      console.log('\n♻️  CSS source changed');
      build();
    });
  }
}
