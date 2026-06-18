const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const BolepixAd = require('../models/BolepixAd');
const ApiError = require('../errors/ApiError');

const UPLOAD_ROOT = path.resolve(__dirname, '../../uploads/bolepix-ads');
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function parseDate(value, field) {
  if (value == null || value === '') return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw ApiError.badRequest(`${field} inválido.`);
  return parsed;
}

function validatePeriod(startsAt, endsAt) {
  if (startsAt && endsAt && startsAt >= endsAt) {
    throw ApiError.badRequest('A data final deve ser posterior à data inicial.');
  }
}

function decodeImageDataUrl(imageDataUrl) {
  if (typeof imageDataUrl !== 'string') throw ApiError.badRequest('Selecione uma imagem para o banner.');
  const match = imageDataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match || !IMAGE_TYPES[match[1]]) {
    throw ApiError.badRequest('Formato inválido. Envie uma imagem JPG, PNG ou WebP.');
  }
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
  const filename = path.basename(String(imageUrl));
  await fs.unlink(path.join(UPLOAD_ROOT, filename)).catch((err) => {
    if (err && err.code !== 'ENOENT') console.warn('[BOLEPIX_AD] falha ao remover imagem antiga:', err.message);
  });
}

function serialize(ad, publicBaseUrl) {
  if (!ad) return null;
  const item = typeof ad.toObject === 'function' ? ad.toObject() : ad;
  const imageUrl = String(item.imageUrl || '');
  return {
    ...item,
    imageUrl: imageUrl.startsWith('/') ? `${publicBaseUrl}${imageUrl}` : imageUrl,
  };
}

async function getAdminAd(tenantId, publicBaseUrl) {
  const ad = await BolepixAd.findOne({ tenantId }).lean();
  return serialize(ad, publicBaseUrl);
}

async function upsertAd(tenantId, data, publicBaseUrl) {
  const current = await BolepixAd.findOne({ tenantId });
  let nextImageUrl = current?.imageUrl || '';

  if (data.imageDataUrl) nextImageUrl = await saveImage(tenantId, data.imageDataUrl);
  if (!nextImageUrl) throw ApiError.badRequest('Selecione uma imagem para o banner.');

  const startsAt = parseDate(data.startsAt, 'Data inicial');
  const endsAt = parseDate(data.endsAt, 'Data final');
  validatePeriod(startsAt, endsAt);

  let saved;
  try {
    saved = await BolepixAd.findOneAndUpdate(
      { tenantId },
      {
        $set: {
          title: String(data.title || 'Banner promocional').trim().slice(0, 120),
          imageUrl: nextImageUrl,
          isActive: data.isActive === true,
          startsAt,
          endsAt,
        },
      },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    );
  } catch (err) {
    if (nextImageUrl !== current?.imageUrl) await removeOwnedImage(nextImageUrl);
    throw err;
  }

  if (current?.imageUrl && current.imageUrl !== nextImageUrl) await removeOwnedImage(current.imageUrl);
  return serialize(saved, publicBaseUrl);
}

async function setActive(tenantId, isActive, publicBaseUrl) {
  const ad = await BolepixAd.findOneAndUpdate(
    { tenantId },
    { $set: { isActive: isActive === true } },
    { new: true, runValidators: true },
  );
  if (!ad) throw ApiError.notFound('Banner do BolePix ainda não configurado.');
  return serialize(ad, publicBaseUrl);
}

async function getActiveAd(tenantId, publicBaseUrl) {
  const now = new Date();
  const ad = await BolepixAd.findOne({
    tenantId,
    isActive: true,
    $and: [
      { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
      { $or: [{ endsAt: null }, { endsAt: { $gt: now } }] },
    ],
  }).lean();
  return serialize(ad, publicBaseUrl);
}

module.exports = { getAdminAd, upsertAd, setActive, getActiveAd };
