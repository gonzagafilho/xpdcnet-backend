const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const PartnerAd = require('../models/PartnerAd');
const ApiError = require('../errors/ApiError');

const UPLOAD_ROOT = path.resolve(__dirname, '../../uploads/bolepix-partners');
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function assertId(id) {
  if (!mongoose.Types.ObjectId.isValid(String(id || ''))) throw ApiError.badRequest('Parceiro inválido.');
}
function parseDate(value, field) {
  if (value == null || value === '') return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw ApiError.badRequest(`${field} inválido.`);
  return parsed;
}
function normalize(data, current = null) {
  const startsAt = parseDate(data.startsAt, 'Data inicial');
  const endsAt = parseDate(data.endsAt, 'Data final');
  if (startsAt && endsAt && startsAt >= endsAt) throw ApiError.badRequest('A data final deve ser posterior à data inicial.');
  const name = String(data.name || current?.name || '').trim().slice(0, 120);
  const category = String(data.category || current?.category || '').trim().slice(0, 80);
  if (!name) throw ApiError.badRequest('Nome do parceiro é obrigatório.');
  if (!category) throw ApiError.badRequest('Categoria do parceiro é obrigatória.');
  return {
    name, category, startsAt, endsAt,
    whatsapp: String(data.whatsapp || '').trim().slice(0, 40),
    website: String(data.website || '').trim().slice(0, 500),
    priority: Math.max(1, Math.min(100, Number(data.priority ?? current?.priority ?? 1) || 1)),
    isActive: data.isActive === true,
  };
}
function decodeImage(imageDataUrl) {
  const match = typeof imageDataUrl === 'string' && imageDataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match || !IMAGE_TYPES[match[1]]) throw ApiError.badRequest('Envie uma imagem JPG, PNG ou WebP.');
  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) throw ApiError.badRequest('A imagem deve ter entre 1 byte e 5 MB.');
  return { buffer, extension: IMAGE_TYPES[match[1]] };
}
async function saveImage(tenantId, imageDataUrl) {
  const { buffer, extension } = decodeImage(imageDataUrl);
  await fs.mkdir(UPLOAD_ROOT, { recursive: true });
  const filename = `${tenantId}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${extension}`;
  await fs.writeFile(path.join(UPLOAD_ROOT, filename), buffer, { flag: 'wx' });
  return `/uploads/bolepix-partners/${filename}`;
}
async function removeImage(imageUrl) {
  if (!String(imageUrl || '').startsWith('/uploads/bolepix-partners/')) return;
  await fs.unlink(path.join(UPLOAD_ROOT, path.basename(imageUrl))).catch((err) => { if (err?.code !== 'ENOENT') console.warn('[PARTNER_AD]', err.message); });
}
function status(item, now = new Date()) {
  if (item.endsAt && new Date(item.endsAt) <= now) return 'ended';
  if (!item.isActive) return 'inactive';
  if (item.startsAt && new Date(item.startsAt) > now) return 'scheduled';
  return 'active';
}
function serialize(doc, base) {
  const item = typeof doc?.toObject === 'function' ? doc.toObject() : doc;
  if (!item) return null;
  const imageUrl = String(item.imageUrl || '');
  return { ...item, imageUrl: imageUrl.startsWith('/') ? `${base}${imageUrl}` : imageUrl, status: status(item) };
}
async function list(tenantId, base) {
  const items = await PartnerAd.find({ tenantId }).sort({ priority: -1, createdAt: -1 }).lean();
  return items.map((item) => serialize(item, base));
}
async function create(tenantId, data, base) {
  if (!data.imageDataUrl) throw ApiError.badRequest('Selecione uma imagem.');
  const imageUrl = await saveImage(tenantId, data.imageDataUrl);
  try { return serialize(await PartnerAd.create({ tenantId, imageUrl, ...normalize(data) }), base); }
  catch (err) { await removeImage(imageUrl); throw err; }
}
async function update(tenantId, id, data, base) {
  assertId(id);
  const current = await PartnerAd.findOne({ _id: id, tenantId });
  if (!current) throw ApiError.notFound('Parceiro não encontrado.');
  const previous = current.imageUrl;
  const imageUrl = data.imageDataUrl ? await saveImage(tenantId, data.imageDataUrl) : previous;
  try { Object.assign(current, normalize(data, current), { imageUrl }); await current.save(); }
  catch (err) { if (imageUrl !== previous) await removeImage(imageUrl); throw err; }
  if (imageUrl !== previous) await removeImage(previous);
  return serialize(current, base);
}
async function setActive(tenantId, id, isActive, base) {
  assertId(id);
  const item = await PartnerAd.findOneAndUpdate({ _id: id, tenantId }, { $set: { isActive: isActive === true } }, { new: true, runValidators: true });
  if (!item) throw ApiError.notFound('Parceiro não encontrado.');
  return serialize(item, base);
}
async function remove(tenantId, id) {
  assertId(id);
  const item = await PartnerAd.findOneAndDelete({ _id: id, tenantId });
  if (!item) throw ApiError.notFound('Parceiro não encontrado.');
  await removeImage(item.imageUrl);
}
function activeFilter(tenantId, now) {
  return { tenantId, isActive: true, $and: [{ $or: [{ startsAt: null }, { startsAt: { $lte: now } }] }, { $or: [{ endsAt: null }, { endsAt: { $gt: now } }] }] };
}
function weightedSample(items, limit) {
  const pool = [...items]; const selected = [];
  while (pool.length && selected.length < limit) {
    const total = pool.reduce((sum, item) => sum + Math.max(1, Number(item.priority) || 1), 0);
    let cursor = Math.random() * total; let index = 0;
    for (; index < pool.length; index += 1) { cursor -= Math.max(1, Number(pool[index].priority) || 1); if (cursor <= 0) break; }
    selected.push(pool.splice(Math.min(index, pool.length - 1), 1)[0]);
  }
  return selected;
}
async function selectAndRecord(tenantId, base) {
  const now = new Date();
  const eligible = await PartnerAd.find(activeFilter(tenantId, now)).lean();
  const selected = weightedSample(eligible, 4);
  if (!selected.length) return [];
  const ids = selected.map((item) => item._id);
  await PartnerAd.updateMany({ _id: { $in: ids }, tenantId }, { $inc: { impressions: 1 }, $set: { lastDisplayedAt: now } });
  return selected.map((item) => serialize({ ...item, impressions: Number(item.impressions || 0) + 1, lastDisplayedAt: now }, base));
}
async function recordClick(tenantId, id) {
  assertId(id);
  const item = await PartnerAd.findOneAndUpdate({ _id: id, tenantId }, { $inc: { clicks: 1 } }, { new: true });
  if (!item) throw ApiError.notFound('Parceiro não encontrado.');
  return { clicks: item.clicks };
}
async function stats(tenantId, base) {
  const items = await list(tenantId, base);
  return { totalImpressions: items.reduce((sum, i) => sum + Number(i.impressions || 0), 0), totalClicks: items.reduce((sum, i) => sum + Number(i.clicks || 0), 0), items };
}
module.exports = { list, create, update, setActive, remove, selectAndRecord, recordClick, stats };
