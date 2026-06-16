const customerNotificationService = require('../services/customerNotificationService');

function tenantId(req) {
  return req.customer.tenantId;
}

function clientId(req) {
  return req.customer.clientId;
}

exports.listNotifications = async (req, res, next) => {
  try {
    res.json({ items: await customerNotificationService.listNotifications(tenantId(req), clientId(req), req.query || {}) });
  } catch (err) {
    next(err);
  }
};

exports.unreadCount = async (req, res, next) => {
  try {
    res.json({ unreadCount: await customerNotificationService.unreadCount(tenantId(req), clientId(req)) });
  } catch (err) {
    next(err);
  }
};

exports.markAsRead = async (req, res, next) => {
  try {
    res.json(await customerNotificationService.markAsRead(tenantId(req), clientId(req), req.params.id));
  } catch (err) {
    next(err);
  }
};

exports.markAllAsRead = async (req, res, next) => {
  try {
    res.json(await customerNotificationService.markAllAsRead(tenantId(req), clientId(req)));
  } catch (err) {
    next(err);
  }
};
