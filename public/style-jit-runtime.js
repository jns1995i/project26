/**
 * style-jit-runtime.js
 * ─────────────────────────────────────────────────────
 * Browser runtime that works like Tailwind's JIT:
 * - Scans the DOM for class names
 * - Fetches only the matching rules from style.css
 * - Injects them into a <style> tag
 * - Watches for DOM changes and adds new rules on the fly
 * 
 * Usage (add to your HTML before closing </body>):
 * 
 *   <script>
 *     window.StyleJIT = { cssPath: '/style.css' };
 *   </script>
 *   <script src="/style-jit-runtime.js"></script>
 * 
 * Or with options:
 *   window.StyleJIT = {
 *     cssPath: '/style.css',
 *     inject: true,           // auto-inject on load (default: true)
 *     watch: true,            // watch DOM mutations (default: true)
 *     debug: false,           // log matched classes (default: false)
 *     keepBase: true,         // always inject base/element styles (default: true)
 *   };
 */

(function () {
  'use strict';

  // ── Config ──────────────────────────────────────────────────────────────────

  const config = Object.assign({
    cssPath: '/style.css',
    inject: true,
    watch: true,
    debug: false,
    keepBase: true,
  }, window.StyleJIT || {});

  // ── State ───────────────────────────────────────────────────────────────────

  let fullCSS = null;
  let cssRules = null;      // parsed rules map: className -> rule text
  let baseRules = '';       // always-included base element styles
  let injectedClasses = new Set();
  let styleTag = null;
  let pendingClasses = new Set();
  let flushTimer = null;

  // ── Style Tag Setup ─────────────────────────────────────────────────────────

  function getStyleTag() {
    if (!styleTag) {
      styleTag = document.createElement('style');
      styleTag.id = 'style-jit';
      styleTag.setAttribute('data-jit', 'true');
      document.head.appendChild(styleTag);
    }
    return styleTag;
  }

  // ── CSS Parsing ─────────────────────────────────────────────────────────────

  function parseCSS(cssText) {
    const map = {};           // className -> [rule strings]
    const base = [];

    const len = cssText.length;
    let pos = 0;

    const baseSelectors = /^(\*|html|body|div|section|main|p\b|hr|form|input|select|textarea|label|fieldset|option|table|thead|tbody|tr|th|td|a\b|button\b|i\b|img|progress|:root|h[1-6]|ul|ol|li|nav|span|header|footer|@import|@charset)/;

    function extractBlock(start) {
      let depth = 0, j = start;
      while (j < len) {
        if (cssText[j] === '{') depth++;
        else if (cssText[j] === '}') { depth--; if (depth === 0) return j; }
        j++;
      }
      return j;
    }

    while (pos < len) {
      // skip whitespace
      while (pos < len && /\s/.test(cssText[pos])) pos++;
      if (pos >= len) break;

      // skip comments
      if (cssText.startsWith('/*', pos)) {
        const end = cssText.indexOf('*/', pos + 2);
        pos = end === -1 ? len : end + 2;
        continue;
      }

      // @import / @charset
      if (cssText.startsWith('@import', pos) || cssText.startsWith('@charset', pos)) {
        const end = cssText.indexOf(';', pos);
        const endPos = end === -1 ? len : end + 1;
        base.push(cssText.slice(pos, endPos));
        pos = endPos;
        continue;
      }

      // @keyframes - keep in base
      if (cssText.startsWith('@keyframe', pos)) {
        const braceStart = cssText.indexOf('{', pos);
        if (braceStart === -1) { pos = len; continue; }
        const braceEnd = extractBlock(braceStart);
        base.push(cssText.slice(pos, braceEnd + 1));
        pos = braceEnd + 1;
        continue;
      }

      // @media - parse internally, store per-class entries
      if (cssText.startsWith('@media', pos)) {
        const firstBrace = cssText.indexOf('{', pos);
        if (firstBrace === -1) { pos = len; continue; }
        const lastBrace = extractBlock(firstBrace);
        const mediaHeader = cssText.slice(pos, firstBrace + 1);
        const mediaInner = cssText.slice(firstBrace + 1, lastBrace);
        pos = lastBrace + 1;

        // Parse inner rules of media block
        let mp = 0;
        const ml = mediaInner.length;
        const mediaBaseRules = [];

        while (mp < ml) {
          while (mp < ml && /\s/.test(mediaInner[mp])) mp++;
          if (mp >= ml) break;

          if (mediaInner.startsWith('/*', mp)) {
            const end = mediaInner.indexOf('*/', mp + 2);
            mp = end === -1 ? ml : end + 2;
            continue;
          }

          const braceStart = mediaInner.indexOf('{', mp);
          if (braceStart === -1) { mp = ml; continue; }
          const selector = mediaInner.slice(mp, braceStart).trim();

          let depth = 0, q = braceStart;
          while (q < ml) {
            if (mediaInner[q] === '{') depth++;
            else if (mediaInner[q] === '}') { depth--; if (depth === 0) break; }
            q++;
          }
          const ruleRaw = mediaInner.slice(mp, q + 1);
          mp = q + 1;

          const classMatches = selector.match(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g);
          if (!classMatches && baseSelectors.test(selector)) {
            mediaBaseRules.push(ruleRaw);
          } else if (classMatches) {
            classMatches.forEach(cn => {
              const name = cn.slice(1);
              const wrappedRule = `${mediaHeader}\n${ruleRaw}\n}`;
              if (!map[name]) map[name] = [];
              // Avoid duplicate media wrappers
              map[name].push(wrappedRule);
            });
          }
        }

        if (mediaBaseRules.length > 0) {
          base.push(`${mediaHeader}\n${mediaBaseRules.join('\n')}\n}`);
        }
        continue;
      }

      // Regular rule
      const braceStart = cssText.indexOf('{', pos);
      if (braceStart === -1) { pos = len; continue; }
      const selector = cssText.slice(pos, braceStart).trim();
      const braceEnd = extractBlock(braceStart);
      const raw = cssText.slice(pos, braceEnd + 1);
      pos = braceEnd + 1;

      const classMatches = selector.match(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g);

      if (!classMatches) {
        // Base element rule
        if (config.keepBase) base.push(raw);
      } else {
        // Map each class to this rule
        classMatches.forEach(cn => {
          const name = cn.slice(1);
          if (!map[name]) map[name] = [];
          map[name].push(raw);
        });
      }
    }

    return { map, base: base.join('\n') };
  }

  // ── DOM Scanner ─────────────────────────────────────────────────────────────

  function scanDOM(root) {
    const found = new Set();
    const walker = document.createTreeWalker(root || document.body, NodeFilter.SHOW_ELEMENT);
    let node = walker.currentNode;
    while (node) {
      if (node.classList) {
        node.classList.forEach(cls => found.add(cls));
      }
      node = walker.nextNode();
    }
    return found;
  }

  // ── Inject Rules ─────────────────────────────────────────────────────────────

  function injectClasses(classes) {
    if (!cssRules) return;
    const tag = getStyleTag();
    const newRules = [];

    classes.forEach(cls => {
      if (injectedClasses.has(cls)) return;
      injectedClasses.add(cls);

      const rules = cssRules[cls];
      if (rules) {
        newRules.push(...rules);
        if (config.debug) console.log(`[StyleJIT] +.${cls}`);
      }
    });

    if (newRules.length > 0) {
      tag.textContent += '\n' + newRules.join('\n');
    }
  }

  function flushPending() {
    flushTimer = null;
    if (pendingClasses.size > 0) {
      injectClasses(pendingClasses);
      pendingClasses.clear();
    }
  }

  function scheduleInject(classes) {
    classes.forEach(c => pendingClasses.add(c));
    if (!flushTimer) {
      flushTimer = requestAnimationFrame(flushPending);
    }
  }

  // ── MutationObserver ─────────────────────────────────────────────────────────

  function watchDOM() {
    const observer = new MutationObserver(mutations => {
      const newClasses = new Set();
      mutations.forEach(mutation => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          mutation.target.classList.forEach(c => newClasses.add(c));
        } else if (mutation.type === 'childList') {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === 1) {
              const classes = scanDOM(node);
              classes.forEach(c => newClasses.add(c));
            }
          });
        }
      });
      if (newClasses.size > 0) scheduleInject(newClasses);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });

    return observer;
  }

  // ── Init ─────────────────────────────────────────────────────────────────────

  async function init() {
    if (config.debug) console.time('[StyleJIT] Load');

    try {
      const res = await fetch(config.cssPath);
      if (!res.ok) throw new Error(`Failed to fetch ${config.cssPath}: ${res.status}`);
      fullCSS = await res.text();
    } catch (err) {
      console.error('[StyleJIT] Error loading CSS:', err);
      return;
    }

    const parsed = parseCSS(fullCSS);
    cssRules = parsed.map;
    baseRules = parsed.base;

    if (config.debug) {
      console.timeEnd('[StyleJIT] Load');
      console.log(`[StyleJIT] Parsed ${Object.keys(cssRules).length} class rules`);
    }

    // Inject base styles immediately
    const tag = getStyleTag();
    tag.textContent = baseRules;

    // Inject classes already in DOM
    const domClasses = scanDOM(document.body);
    injectClasses(domClasses);

    // Watch for future changes
    if (config.watch) watchDOM();

    if (config.debug) {
      console.log(`[StyleJIT] Initial scan: ${domClasses.size} classes`);
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  window.StyleJIT = Object.assign(config, {
    /** Manually inject specific class names */
    inject: function(classes) {
      if (!Array.isArray(classes)) classes = [classes];
      injectClasses(classes);
    },
    /** Re-scan the entire DOM and inject any missing classes */
    rescan: function() {
      const classes = scanDOM(document.body);
      injectClasses(classes);
    },
    /** Get list of currently injected class names */
    getInjected: function() {
      return [...injectedClasses];
    },
    /** Get list of all available class names in the CSS */
    getAvailable: function() {
      return cssRules ? Object.keys(cssRules) : [];
    },
  });

  // ── Start ─────────────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
