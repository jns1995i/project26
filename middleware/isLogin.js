
const dayjs = require('dayjs');
const relativeTime = require('dayjs/plugin/relativeTime');
dayjs.extend(relativeTime);

const User = require('../model/user');
const Request = require('../model/request');
const Item = require('../model/item'); // import item model

module.exports = async (req, res, next) => {
  try {
    if (!req.session || !req.session.user) {
      console.log('⚠️ Unauthorized access attempt — Please login first!');
      req.session.error = 'Please login first!';
      return res.redirect('/');
    }

    const user = await User.findById(req.session.user._id);
    if (!user) {
      req.session.destroy();
      return res.redirect('/');
    }

    req.user = user;
    res.locals.user = user;

    // Fetch all requests where user is requestBy, processBy, or releaseBy
    const userRequests = await Request.find({
      $or: [
        { requestBy: user._id },
        { processBy: user._id },
        { releaseBy: user._id }
      ]
    })
    .populate('requestBy')
    .populate('processBy')
    .populate('releaseBy')
    .sort({ createdAt: -1 });

    // For each request, fetch matching items by tr
    const requestsWithItems = await Promise.all(userRequests.map(async rq => {
      const items = await Item.find({ tr: rq.tr });
      const obj = rq.toObject();

      // Add formatted dates manually
      obj.createdAtFormatted = rq.createdAt ? dayjs(rq.createdAt).format('MMM D, YYYY h:mm A') : '—';
      obj.assignAtFormatted = rq.assignAt ? dayjs(rq.assignAt).format('MMM D, YYYY h:mm A') : '—';

      obj.items = items;
      return obj;
    }));

    req.userRequests = requestsWithItems;
    res.locals.userRequests = requestsWithItems;

    console.log(`✅ Logged in as ${user.fName} ${user.lName}`);
    console.log(`📦 Found ${userRequests.length} related requests`);

    next();
  } catch (err) {
    console.error('⚠️ Error in isLogin middleware:', err);
    res.status(500).render('index', {
      title: 'Login Error',
      error: 'Internal Server Error: Unable to load user data.'
    });
  }
};
