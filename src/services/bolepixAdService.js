const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const BolepixAd = require('../models/BolepixAd');
const ApiError = require('../errors/ApiError');

const UPLOAD_ROOT = path.resolve(__dirname, '../../uploads/bolepix-ads');
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const CATEGORIES = new Set(['institucional', 'upgrade', 'promocao', 'indique_ganhe', 'patrocinado']);
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
let indexMigrationPromise = null;

async function ensureMultiCampaignIndexes() {
  if (!indexMigrationPromise) {
    indexMigrationPromise = (async () => {
      try {
        const indexes = await BolepixAd.collection.indexes();
        const legacy = indexes.find((index) => index.unique === true && index.key?.tenantId === 1 && Object.keys(index.key).length === 1);
        if (legacy?.name) await BolepixAd.collection.dropIndex(legacy.name);
        await BolepixAd.createIndexes();
      } catch (err) {
        if (!['NamespaceNotFound', 'IndexNotFound'].includes(err?.codeName)) throw err;
      }
    })().catch((err) => {
      indexMigrationPromise = null;
      throw err;
    });
  }
  return indexMigrationPromise;
}

function assertId(id) {
  if (!mongoose.Types.ObjectId.isValid(String(id || ''))) throw ApiError.badRequest('Campanha inválida.');
}

function parseDate(value, field) {
  if (value == null || value === '') return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw ApiError.badRequest(`${field} inválido.`);
  return parsed;
}

function normalizeData(data, current = null) {
  const startsAt = parseDate(data.startsAt, 'Data inicial');
  const endsAt = parseDate(data.endsAt, 'Data final');
  if (startsAt && endsAt && startsAt >= endsAt) throw ApiError.badRequest('A data final deve ser posterior à data inicial.');

  const category = String(data.category || current?.category || 'institucional').trim().toLowerCase();
  if (!CATEGORIES.has(category)) throw ApiError.badRequest('Categoria de campanha inválida.');

  const priority = Math.max(1, Math.min(100, Number(data.priority ?? current?.priority ?? 1) || 1));
  return {
    title: String(data.title || current?.title || 'Banner promocional').trim().slice(0, 120),
    isActive: data.isActive === true,
    startsAt,
    endsAt,
    priority,
    category,
    sponsorName: String(data.sponsorName || '').trim().slice(0, 120),
  };
}

function decodeImageDataUrl(imageDataUrl) {
  if (typeof imageDataUrl !== 'string') throw ApiError.badRequest('Selecione uma imagem para o banner.');
  const match = imageDataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match || !IMAGE_TYPES[match[1]]) throw ApiError.badRequest('Formato inválido. Envie uma imagem JPG, PNG ou WebP.');
  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (!buffer.length) throw ApiError.badRequest('A imagem enviada está vazia.');
  if (buffer.length > MAX_IMAGE_BYTES) throw ApiError.badRequest('A imagem deve ter no máximo 5 MB.');
  return { buffer, extension: IMAGE_TYPES[match[1]] };
}

async function saveImage(tenantId, imageDataUrl) {
  const { buffer, extension } = decodeImageDataUrl(imageDataUrl);
  await fs.mkdir(UPLOAD_ROOT, { recursive: true });
  const filename = `${tenantId}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${extension}`;
  await fs.writeFile(path.join(UPLOAD_ROOT, filename), buffer, { flag: 'wx' });
  return `/uploads/bolepix-ads/${filename}`;
}

async function removeOwnedImage(imageUrl) {
  const prefix = '/uploads/bolepix-ads/';
  if (!imageUrl || !String(imageUrl).startsWith(prefix)) return;
  await fs.unlink(path.join(UPLOAD_ROOT, path.basename(String(imageUrl)))).catch((err) => {
    if (err?.code !== 'ENOENT') console.warn('[BOLEPIX_AD] falha ao remover imagem:', err.message);
  });
}

function lifecycleStatus(item, now = new Date()) {
  if (item.endsAt && new Date(item.endsAt) <= now) return 'ended';
  if (!item.isActive) return 'inactive';
  if (item.startsAt && new Date(item.startsAt) > now) return 'scheduled';
  return 'active';
}

function serialize(ad, publicBaseUrl) {
  if (!ad) return null;
  const item = typeof ad.toObject === 'function' ? ad.toObject() : ad;
  const imageUrl = String(item.imageUrl || '');
  return {
    ...item,
    imageUrl: imageUrl.startsWith('/') ? `${publicBaseUrl}${imageUrl}` : imageUrl,
    status: lifecycleStatus(item),
  };
}

async function listAds(tenantId, publicBaseUrl) {
  await ensureMultiCampaignIndexes();
  const items = await BolepixAd.find({ tenantId }).sort({ priority: -1, createdAt: -1 }).lean();
  return items.map((item) => serialize(item, publicBaseUrl));
}

async function createAd(tenantId, data, publicBaseUrl) {
  await ensureMultiCampaignIndexes();
  if (!data.imageDataUrl) throw ApiError.badRequest('Selecione uma imagem para o banner.');
  const imageUrl = await saveImage(tenantId, data.imageDataUrl);
  try {
    const ad = await BolepixAd.create({ tenantId, imageUrl, ...normalizeData(data) });
    return serialize(ad, publicBaseUrl);
  } catch (err) {
    await removeOwnedImage(imageUrl);
    throw err;
  }
}

async function updateAd(tenantId, id, data, publicBaseUrl) {
  await ensureMultiCampaignIndexes();
  assertId(id);
  const current = await BolepixAd.findOne({ _id: id, tenantId });
  if (!current) throw ApiError.notFound('Campanha não encontrada.');
  const previousImageUrl = current.imageUrl;
  let imageUrl = previousImageUrl;
  if (data.imageDataUrl) imageUrl = await saveImage(tenantId, data.imageDataUrl);
  try {
    Object.assign(current, normalizeData(data, current), { imageUrl });
    await current.save();
  } catch (err) {
    if (imageUrl !== previousImageUrl) await removeOwnedImage(imageUrl);
    throw err;
  }
  if (previousImageUrl !== imageUrl) await removeOwnedImage(previousImageUrl);
  return serialize(current, publicBaseUrl);
}

async function setActive(tenantId, id, isActive, publicBaseUrl) {
  await ensureMultiCampaignIndexes();
  assertId(id);
  const ad = await BolepixAd.findOneAndUpdate({ _id: id, tenantId }, { $set: { isActive: isActive === true } }, { new: true, runValidators: true });
  if (!ad) throw ApiError.notFound('Campanha não encontrada.');
  return serialize(ad, publicBaseUrl);
}

async function deleteAd(tenantId, id) {
  await ensureMultiCampaignIndexes();
  assertId(id);
  const ad = await BolepixAd.findOneAndDelete({ _id: id, tenantId });
  if (!ad) throw ApiError.notFound('Campanha não encontrada.');
  await removeOwnedImage(ad.imageUrl);
}

function activeFilter(tenantId, now) {
  return {
    tenantId,
    isActive: true,
    $and: [
      { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
      { $or: [{ endsAt: null }, { endsAt: { $gt: now } }] },
    ],
  };
}

function weightedPick(items) {
  const total = items.reduce((sum, item) => sum + Math.max(1, Number(item.priority) || 1), 0);
  let cursor = Math.random() * total;
  for (const item of items) {
    cursor -= Math.max(1, Number(item.priority) || 1);
    if (cursor <= 0) return item;
  }
  return items[items.length - 1];
}

async function selectAndRecordImpression(tenantId, publicBaseUrl) {
  await ensureMultiCampaignIndexes();
  const now = new Date();
  const eligible = await BolepixAd.find(activeFilter(tenantId, now)).select('_id priority').lean();
  if (!eligible.length) return null;
  const selected = weightedPick(eligible);
  const ad = await BolepixAd.findOneAndUpdate(
    { _id: selected._id, ...activeFilter(tenantId, now) },
    { $inc: { impressions: 1 } },
    { new: true },
  );
  return serialize(ad, publicBaseUrl);
}

async function recordClick(tenantId, id) {
  assertId(id);
  const ad = await BolepixAd.findOneAndUpdate({ _id: id, tenantId }, { $inc: { clicks: 1 } }, { new: true });
  if (!ad) throw ApiError.notFound('Campanha não encontrada.');
  return { clicks: ad.clicks };
}

async function getStats(tenantId, publicBaseUrl) {
  const items = await listAds(tenantId, publicBaseUrl);
  const now = new Date();
  const active = items.filter((item) => lifecycleStatus(item, now) === 'active');
  const ended = items.filter((item) => lifecycleStatus(item, now) === 'ended');
  const mostDisplayed = [...items].sort((a, b) => Number(b.impressions || 0) - Number(a.impressions || 0))[0] || null;
  return {
    totalImpressions: items.reduce((sum, item) => sum + Number(item.impressions || 0), 0),
    totalClicks: items.reduce((sum, item) => sum + Number(item.clicks || 0), 0),
    activeCampaigns: active.length,
    endedCampaigns: ended.length,
    mostDisplayed,
    items,
  };
}

module.exports = { listAds, createAd, updateAd, setActive, deleteAd, selectAndRecordImpression, recordClick, getStats };
