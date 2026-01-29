const dayjs = require('dayjs');
const relativeTime = require('dayjs/plugin/relativeTime');
dayjs.extend(relativeTime);

const Log = require('../model/logs');

module.exports = async (req, res, next) => {
  try {
    // ✅ Fetch all logs, newest first
    const allLogs = await Log.find().sort({ createdAt: -1 }).lean(); // lean() gives plain JS objects

    // ✅ Format createdAt and updatedAt for each log
    const formattedLogs = allLogs.map(log => {
      return {
        ...log,
        createdAtFormatted: log.createdAt ? dayjs(log.createdAt).format('MMM D, YYYY h:mm:ss A') : '—',
        createdAtAgo: log.createdAt ? dayjs(log.createdAt).fromNow() : '—',
        updatedAtFormatted: log.updatedAt ? dayjs(log.updatedAt).format('MMM D, YYYY h:mm A') : '—',
        updatedAtAgo: log.updatedAt ? dayjs(log.updatedAt).fromNow() : '—'
      };
    });

    // ✅ Make logs available globally
    req.logs = formattedLogs;
    res.locals.logs = formattedLogs;

    console.log(`📜 Logs loaded: ${formattedLogs.length} entries`);

    next();
  } catch (err) {
    console.error('⚠️ Error in isLog middleware:', err);
    req.logs = [];
    res.locals.logs = [];
    next();
  }
};
