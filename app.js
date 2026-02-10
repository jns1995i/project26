require('dotenv').config();
const express = require('express');
const path = require('path');
const morgan = require('morgan');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoDBStore = require('connect-mongodb-session')(session);
const engine = require('ejs-mate');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');
const dayjs = require('dayjs');
const helmet = require('helmet');


const isLogin = require('./middleware/isLogin');
const isLog = require('./middleware/isLog');

const users = require('./model/user');
const Log = require('./model/logs');
const { isWeakMap } = require('util/types');

const app = express();
const PORT = process.env.PORT || 1000;
process.env.TZ = "Asia/Manila";

// Database Connection to!
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Audres25 DB Access Granted'))
  .catch(err => console.error('❌ Audres25 DB Access Denied, Why? :', err));

// Setup ng Session
const store = new MongoDBStore({
  uri: process.env.MONGO_URI,
  collection: 'sessions'
});

store.on('error', (error) => {
  console.error('Naku, Session store error:', error);
});

// Mga Middleware
app.engine('ejs', engine);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(morgan('dev'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '0',
  etag: true
}));

app.use(session({
  secret: process.env.SESSION_SECRET || 'ferry2025',
  resave: false,
  saveUninitialized: false,
  store: store,
  cookie: { 
    maxAge: 1000 * 60 * 60 * 24 // para matic isang araw lang
  }
}));

// Helmet security middleware
app.use(
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://cdnjs.cloudflare.com",
        "https://cdn.jsdelivr.net",
        "https://kit.fontawesome.com",
        "https://ka-f.fontawesome.com",
        "https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js",
        "https://cdn.sheetjs.com/*"
      ],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://fonts.googleapis.com",
        "https://cdnjs.cloudflare.com",
        "https://cdn.jsdelivr.net",
        "https://ka-f.fontawesome.com"
      ],
      fontSrc: [
        "'self'",
        "https://fonts.gstatic.com",
        "https://fonts.googleapis.com",
        "https://cdnjs.cloudflare.com",
        "https://cdn.jsdelivr.net",
        "https://ka-f.fontawesome.com"
      ],
      imgSrc: [
        "'self'",
        "data:",
        "https://res.cloudinary.com",
      ],
      connectSrc: [
        "'self'",
        "https://ka-f.fontawesome.com",
        "https://cdn.jsdelivr.net"
      ],
      objectSrc: ["'none'"],
      frameSrc: ["'self'"],
    }
  })
);


app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

app.use((req, res, next) => {
  // console.log(`ID Session ID: ${req.sessionID}`);
  next();
});

app.use((req, res, next) => {
  try {
    if (req.session && req.session.user) {
      // Only expose safe user data to EJS (avoid password or other sensitive fields)
      const { _id, id, username, email, role } = req.session.user;
      res.locals.user = { _id, id, username, email, role };
    } else {
      res.locals.user = null;
    }
  } catch (err) {
    console.error('⚠️ Error setting res.locals.user:', err);
    res.locals.user = null;
  }
  next();
});

const flash = require('connect-flash');
const { truncate } = require('fs/promises');

app.use(flash());

app.use((req, res, next) => {
  res.locals.messageSuccess = req.flash('messageSuccess');
  res.locals.messagePass = req.flash('messagePass');
  next();
});

// Global variables na ipapasok sa lahat ng page
app.use((req, res, next) => {
  // Transfer any session messages to res.locals (so they show in EJS)
  
  res.locals.back = '';
  res.locals.active = '';
  res.locals.error = req.session.error || null;
  res.locals.message = req.session.message || null;
  res.locals.warning = req.session.warning || null;
  res.locals.success = req.session.success || null;
  res.locals.denied = req.session.denied || null;

  // Always include the user if logged in
  res.locals.user = req.session.user || null;

  // Clear messages after showing them once (like flash messages)
  req.session.error = null;
  req.session.message = null;
  req.session.warning = null;
  req.session.success = null;
  req.session.denied = null;

  // console.log(`🌀 Global variables ready Supreme Ferry`);
  next();
});

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Cloudinary storage
const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => ({
    folder: 'audres25', // your folder in Cloudinary
    resource_type: 'auto',
    public_id: `${Date.now()}-${file.originalname}`
  })
});

// Create multer middleware
const upload = multer({
  storage,
  limits: { fileSize: 524288000 }, // 500MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed!"));
    }
    cb(null, true);
  }
});

const cpUpload = upload.any();

const photoStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => ({
    folder: 'audres25', // your folder in Cloudinary
    resource_type: 'auto',
    public_id: `${Date.now()}-${file.originalname}`
  })
});

// Multer middleware for single file upload
const uploadPhoto = multer({
  storage: photoStorage,
  limits: { fileSize: 524288000 }, // 500MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files allowed!"));
    }
    cb(null, true);
  }
});

function generatePassword() {
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const numbers = "0123456789";
  const symbols = "!@#$%^&*()_+-=[]{}";

  // Ensure at least one of each
  const pick = (str) => str[Math.floor(Math.random() * str.length)];

  let password = [
    pick(upper),
    pick(lower),
    pick(numbers),
    pick(symbols)
  ];

  // Fill remaining length to reach 8 chars
  const all = upper + lower + numbers + symbols;
  while (password.length < 8) {
    password.push(pick(all));
  }

  // Shuffle for randomness
  return password.sort(() => Math.random() - 0.5).join("");
}

app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.render('req', { 
      error: 'Photo must not exceed 500MB!',
      title: "AUDRESv25"
    });
  }
  next(err);
});

// ================== ROUTES ==================

app.get('/', async (req, res) => {
  try {
    async function ensureUserExists(username, role, password = 'all456', access = 1, custom = {}) {
      // Determine email safely
      const email = custom.email || `${(custom.lName || 'Santos').toLowerCase()}.au@phinmaed.com`;

      // Check if user exists by username or email
      let user = await users.findOne({
        $or: [{ username }, { email }]
      });

      if (user) {
        console.log(`User "${username}" already exists.`);
        return user;
      }

      const baseData = {
        fName: custom.fName || username,
        mName: custom.mName || 'Reyes',
        lName: custom.lName || 'Santos',
        xName: custom.xName || 'III',
        archive: custom.archive || false,
        verify: false,
        suspend: false,
        email,
        phone: custom.phone || '09001234567',
        address: custom.address || 'Cabanatuan City',
        bDay: custom.bDay || 1,
        bMonth: custom.bMonth || 1,
        bYear: custom.bYear || 2000,
        campus: custom.campus || 'Main',
        schoolId: custom.schoolId || '001',
        yearLevel: custom.yearLevel || 'Second Year',
        photo: custom.photo || '',
        vId: custom.vId || '',
        username,
        password,
        role,
        access,
        ...custom
      };

      const newUser = await users.create(baseData);
      console.log(`✅ ${role} testing account "${username}" created!`);
      return newUser;
    }

    await ensureUserExists('Head', 'Head', 'all456', 1);
    await ensureUserExists('Dev', 'Dev', 'all456', 1, {
      email: 'jnsantiago.au@phinmaed.com',
      phone: '09296199578'
    });
    await ensureUserExists('Seed', 'Seed', 'all456', 1, {
      email: 'registrar.au@phinmaed.com',
      phone: '09386571406',
      fName: 'Araullo',
      lName: 'University',
      archive: true
    });

    const ip =
      req.headers['x-forwarded-for']?.split(',')[0].trim() ||
      req.socket.remoteAddress;

    await Log.create({
      who: 'NEW VISIT',
      what: `Someone visited the site with an IP Address of ${ip}`,
      ipAddress: ip,
      device: req.headers['user-agent']
    });

    res.render('index', { title: 'AUDRESv25' });
  } catch (err) {
    console.error('Error in GET / handler:', err);
    res.render('index', { title: 'AUDRESv25' });
  }
});


app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const user = await users.findOne({ username });

    if (!user || user.password !== password) {
      return res.render('index', { 
        title: 'AUDRESv25',
        error: 'Invalid username or password',
        user: req.session.user || null
      });
    }

    // Store user in session
    req.session.user = user;

       // ===== CREATE LOGIN LOG =====
    const isWho = `${user.fName} ${user.mName} ${user.lName} ${user.xName}`;
    await Log.create({
      who: isWho,
      what: 'Logged in'
    });


    if (user.access === 1) {
  
      const adminRoles = ["Admin", "Head", "Dev", "Seed"];

      if (adminRoles.includes(user.role)) {
        return res.redirect('/dsb');

      } else if (user.role === "Registrar") {
        return res.redirect('/dsb');

      } else if (user.role === "Accounting") {
        return res.redirect('/trs');

      } else {
        return res.redirect('/');  // If access=1 but role does not match any
      }

    } else if (user.access === 0) {

      return res.redirect('/hom');

    } else {

      return res.redirect('/'); // Invalid access value

    }

  } catch (err) {
    console.error(err);
    return res.render('index', { 
      title: 'AUDRESv25',
      error: 'Something went wrong. Try again.',
      user: req.session.user || null
    });
  }
});

app.post('/vvp', async (req, res) => {
    const { userId } = req.body;

    try {
        const user = await users.findById(userId);

        if (!user) {
            return res.redirect('/vvp'); // or show error
        }

        req.session.user = user; // override login
               // ===== CREATE LOGIN LOG =====
        const isWho = `${user.fName} ${user.mName} ${user.lName} ${user.xName}`;
        await Log.create({
          who: isWho,
          what: 'Logged in'
        });

        // Redirect like your original login logic
        if (user.access === 1) {
            const adminRoles = ["Admin", "Head", "Dev", "Seed"];

            if (adminRoles.includes(user.role) || user.role === "Registrar") {
                return res.redirect('/dsb');
            } else if (user.role === "Accounting") {
                return res.redirect('/trs');
            } else {
                return res.redirect('/');
            }

        } else if (user.access === 0) {
            return res.redirect('/hom');
        } else {
            return res.redirect('/');
        }

    } catch (err) {
        console.error(err);
        return res.redirect('/vvp');
    }
});

app.get('/tm', async (req, res) => {
  res.render('template');
});

app.use((req, res) => {
  res.status(404);
  res.locals.error = 'Oops! Page cannot be found!';
  console.log(`404 triggered: ${res.locals.error}`);
  res.render('index', { title: 'Invalid URL' });
});

app.use((err, req, res, next) => {
  console.error('⚠️ Error occurred:', err.message);
  res.locals.error = 'Oh no! Page is missing!';
  res.status(500).render('index', { 
    title: 'File Missing',
    message: `OH NO! File in Directory is missing!' ${err.message}`,
    error: 'OH NO! File in Directory is missing!'
  });
});

// Sumakses ka dyan boy!
app.listen(PORT, () => {
  console.log(`🚀 Kudos Supreme Ferry! Running at http://localhost:${PORT}`);
});
