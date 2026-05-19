const {
  getTenantIdFromReq,
  createResetForEmail,
  createResetForUserId,
  resetPasswordWithToken,
} = require("../services/passwordResetService");

function ok(res, data) {
  return res.json({ ok: true, ...data });
}

function bad(res, msg, status = 400) {
  return res.status(status).json({ ok: false, error: msg });
}

// POST /auth/forgot-password
async function forgotPassword(req, res) {
  try {
    const { email } = req.body;
    if (!email) return bad(res, "Email é obrigatório");

    const tenantId = getTenantIdFromReq(req);

    // não revela se existe ou não
    await createResetForEmail({ email, tenantId });

    return ok(res, { message: "Se o email existir, enviaremos instruções." });
  } catch (e) {
    return bad(res, "Erro ao solicitar reset", 500);
  }
}

// POST /auth/reset-password
async function resetPassword(req, res) {
  try {
    const { token, newPassword } = req.body;

    if (!token) return bad(res, "Token é obrigatório");
    if (!newPassword || String(newPassword).length < 8) {
      return bad(res, "Senha fraca (mínimo 8 caracteres)");
    }

    const tenantId = getTenantIdFromReq(req);

    const result = await resetPasswordWithToken({ token, newPassword, tenantId });
    if (!result.ok) return bad(res, result.error);

    return ok(res, { message: "Senha atualizada com sucesso" });
  } catch (e) {
    return bad(res, "Erro ao resetar senha", 500);
  }
}

// POST /auth/admin/users/:id/reset-password-link  (via painel)
async function adminGenerateReset(req, res) {
  try {
    const { id } = req.params;
    const tenantId = getTenantIdFromReq(req);

    const { token } = await createResetForUserId({ adminId: id, tenantId });

    const baseUrl = process.env.PANEL_URL || "http://localhost:3000";
    const link = `${baseUrl}/reset-password?token=${token}`;

    return ok(res, { token, link });
  } catch (e) {
    return bad(res, e.message || "Erro ao gerar reset", 400);
  }
}

module.exports = {
  forgotPassword,
  resetPassword,
  adminGenerateReset,
};