const bcrypt = require("bcryptjs");
const Admin = require("../models/Admin");
const { generateResetToken, hashResetToken } = require("../utils/resetToken");

const RESET_MINUTES = Number(process.env.RESET_PASSWORD_EXPIRES_MINUTES || 30);

function expiresDate(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000);
}

function getTenantIdFromReq(req) {
  // ✅ AJUSTE AQUI se o seu tenantMiddleware usa outro formato:
  // exemplos comuns: req.tenantId, req.tenant._id, req.tenant.id
  return req.tenantId || (req.tenant && (req.tenant._id || req.tenant.id)) || null;
}

// Público: cria token pelo email (sem revelar se existe)
async function createResetForEmail({ email, tenantId }) {
  const query = { email };
  if (tenantId) query.tenantId = tenantId;

  const admin = await Admin.findOne(query);
  if (!admin) return { ok: true };

  const { token, tokenHash } = generateResetToken();
  admin.resetPasswordTokenHash = tokenHash;
  admin.resetPasswordExpiresAt = expiresDate(RESET_MINUTES);
  await admin.save();

  return { ok: true, token, adminId: String(admin._id) };
}

// Painel: cria token para um usuário/admin por ID
async function createResetForUserId({ adminId, tenantId }) {
  const query = { _id: adminId };
  if (tenantId) query.tenantId = tenantId;

  const admin = await Admin.findOne(query);
  if (!admin) throw new Error("Usuário não encontrado");

  const { token, tokenHash } = generateResetToken();
  admin.resetPasswordTokenHash = tokenHash;
  admin.resetPasswordExpiresAt = expiresDate(RESET_MINUTES);
  await admin.save();

  return { token, adminId: String(admin._id) };
}

// Público: aplica nova senha via token
async function resetPasswordWithToken({ token, newPassword, tenantId }) {
  const tokenHash = hashResetToken(token);

  const query = {
    resetPasswordTokenHash: tokenHash,
    resetPasswordExpiresAt: { $gt: new Date() },
  };
  if (tenantId) query.tenantId = tenantId;

  const admin = await Admin.findOne(query);
  if (!admin) return { ok: false, error: "Token inválido ou expirado" };

  const senhaHash = await bcrypt.hash(newPassword, 10);
  admin.senhaHash = senhaHash;

  admin.resetPasswordTokenHash = null;
  admin.resetPasswordExpiresAt = null;

  await admin.save();
  return { ok: true };
}

module.exports = {
  RESET_MINUTES,
  getTenantIdFromReq,
  createResetForEmail,
  createResetForUserId,
  resetPasswordWithToken,
};