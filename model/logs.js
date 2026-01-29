const mongoose = require('mongoose');

const logSchema = new mongoose.Schema({
  who: { type: String, required: true, trim: true },
  what: { type: String, required: true, trim: true }
}, {
  timestamps: true // automatically adds createdAt & updatedAt
});

module.exports = mongoose.model('logs', logSchema);
