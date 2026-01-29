const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  fName: { type: String, required: true, trim: true },
  mName: { type: String, trim: true },
  lName: { type: String, required: true, trim: true },
  xName: { type: String, trim: true },

  archive: { type: Boolean, default: false },

  verify: { type: Boolean, default: false },
  verifyAt: { type: Date },
  unverifyAt: { type: Date },
  unverifyIs: { type: String, trim: true },

  suspend: { type: Boolean, default: false },
  suspendAt: { type: Date },
  suspendIs: { type: String, trim: true },

  role: {
    type: String,
    enum: ['Student', 'Registrar','Accounting','Admin','Head','Alumni','Former','Seed','Dev'],
    required: true
  },
  assign: { type: String, trim: true },

  access: { type: Number, enum: [0, 1], default: 0 },
  reset: { type: Boolean, default: false },


  position: { type: String, trim: true },
  department: { type: String, trim: true },

  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone: { type: String, trim: true },
  address: { type: String, trim: true },

  bDay: { type: Number, min: 1, max: 31 },
  bMonth: { type: Number, min: 1, max: 12 },
  bYear: { type: Number },

  campus: { type: String, trim: true },
  course: { type: String, trim: true },
  schoolId: { type: String, trim: true },
  yearLevel: { type: String, trim: true },
  yearGraduated: { type: String, trim: true },
  yearAttended: { type: String, trim: true },

  photo: { type: String, trim: true },
  vId: { type: String, trim: true },

  username: { type: String, required: true, unique: true, trim: true },
  password: { type: String, required: true }
}, {
  timestamps: true
});

module.exports = mongoose.model('user', userSchema);
