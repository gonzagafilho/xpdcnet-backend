const mongoose = require('mongoose');
const ApiError = require('../errors/ApiError');
const Notification = require('../models/Notification');

function oid(value, field = 'id') {
  if (!mongoose.Types.ObjectId.isValid(String(value))) throw ApiError.badRequest(`${field} invalido`);
  return new mongoose.Types.ObjectId(String(value));
}

function limitFromQuery(query = {}) {
  return Math.min(100, Math.max(1, Number(query.limit) || 50));
}

function safeNotification(notification) {
  return {
    _id: String(notification._id),
    type: notification.type || 'system',
    title: notification.title || '',
    message: notification.message || '',
    isRead: Boolean(notification.isRead),
    createdAt: notification.createdAt || null,
    readAt: notification.readAt || null,
  };
}

function baseFilter(tenantId, clientId) {
  return {
    tenantId: oid(tenantId, 'tenantId'),
    clientId: oid(clientId, 'clientId'),
  };
}

exports.listNotifications = async (tenantId, clientId, query = {}) => {
  const filter = baseFilter(tenantId, clientId);
  if (query.type) filter.type = String(query.type).trim();
  if (query.isRead === 'true') filter.isRead = true;
  if (query.isRead === 'false') filter.isRead = false;

  const rows = await Notification.find(filter)
    .sort({ createdAt: -1 })
    .limit(limitFromQuery(query))
    .lean();

  return rows.map(safeNotification);
};

exports.unreadCount = async (tenantId, clientId) => {
  return Notification.countDocuments({ ...baseFilter(tenantId, clientId), isRead: false });
};

exports.markAsRead = async (tenantId, clientId, notificationId) => {
  const filter = { ...baseFilter(tenantId, clientId), _id: oid(notificationId, 'notificationId') };
  const updated = await Notification.findOneAndUpdate(
    filter,
    { $set: { isRead: true, readAt: new Date() } },
    { new: true },
  ).lean();

  if (!updated) throw ApiError.notFound('Notificacao nao encontrada');
  return safeNotification(updated);
};

exports.markAllAsRead = async (tenantId, clientId) => {
  const filter = { ...baseFilter(tenantId, clientId), isRead: false };
  const result = await Notification.updateMany(filter, { $set: { isRead: true, readAt: new Date() } });
  return { updated: Number(result.modifiedCount || 0) };
};
