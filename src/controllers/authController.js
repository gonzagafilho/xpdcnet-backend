const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const Admin = require('../models/Admin');
const { getJwtSecret } = require('../config/jwt');

function isDatabaseError(err) {
  const name = err.name || '';
  const msg = String(err.message || '');
  return (
    name === 'MongoServerError' ||
    name === 'MongoNetworkError' ||
    name === 'MongooseError' ||
    /MongoNetworkError|MongooseServerSelectionError|not connected|ECONNREFUSED|Authentication failed/i.test(
      msg,
    )
  );
}

async function login(req, res) {
  try {
    const { email, senha } = req.body;

    if (!email || !senha) {
      return res.status(400).json({
        message: 'E-mail e senha obrigatórios',
      });
    }

    const secret = getJwtSecret();
    if (!secret) {
      console.error('[AUTH] JWT não configurado (produção)');
      return res.status(503).json({
        message: 'Configuração do servidor incompleta.',
        code: 'SERVER_MISCONFIGURED',
      });
    }

    const admin = await Admin.findOne({ email });

    if (!admin) {
      console.warn(`[AUTH] Login attempt failed for email: ${email} (usuário não encontrado)`);
      return res.status(401).json({
        message: 'Usuário não encontrado',
      });
    }

    if (admin.ativo === false) {
      console.warn(`[AUTH] Login attempt failed for email: ${email} (usuário inativo)`);
      return res.status(403).json({
        message: 'Usuário inativo',
      });
    }

    const senhaOk = await bcrypt.compare(senha, admin.senhaHash);

    if (!senhaOk) {
      console.warn(`[AUTH] Login attempt failed for email: ${email} (senha inválida)`);
      return res.status(401).json({
        message: 'Senha inválida',
      });
    }

    const token = jwt.sign(
      {
        id: admin._id,
        email: admin.email,
        role: admin.role || 'admin',
      },
      secret,
      { expiresIn: '1d' },
    );

    return res.json({
      token,
      admin: {
        id: admin._id,
        nome: admin.nome || 'Admin',
        email: admin.email,
        role: admin.role || 'admin',
      },
    });
  } catch (error) {
    if (isDatabaseError(error)) {
      console.error('[DB] Erro no login:', error.message);
      return res.status(503).json({
        message: 'Sistema temporariamente indisponível (banco de dados).',
        code: 'DATABASE_UNAVAILABLE',
      });
    }
    console.error('[ERROR] Erro no login:', error.message || error);
    return res.status(500).json({
      message: 'Erro interno no servidor',
      code: 'INTERNAL_ERROR',
    });
  }
}

async function adminGenerateReset(req, res) {
  try {
    const { id } = req.params;

    const admin = await Admin.findById(id);

    if (!admin) {
      return res.status(404).json({
        message: 'Usuário não encontrado',
      });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    admin.resetPasswordTokenHash = tokenHash;
    admin.resetPasswordExpiresAt = new Date(Date.now() + 30 * 60 * 1000);

    await admin.save();

    /**
     * URL base do painel admin para o operador abrir o fluxo de nova senha.
     * Defina ADMIN_PASSWORD_RESET_BASE_URL (ex.: https://admin.empresa.pt) em produção.
     */
    const resetBase = String(process.env.ADMIN_PASSWORD_RESET_BASE_URL || '').replace(/\/$/, '');
    const link = resetBase
      ? `${resetBase}/reset-password?token=${token}`
      : `/reset-password?token=${token}`;

    return res.json({
      ok: true,
      token,
      link,
    });
  } catch (error) {
    console.error('Erro ao gerar reset:', error);
    return res.status(500).json({
      message: 'Erro ao gerar reset',
    });
  }
}

async function resetPassword(req, res) {
  try {
    const { token, novaSenha } = req.body;

    if (!token || !novaSenha) {
      return res.status(400).json({
        message: 'Token e novaSenha são obrigatórios',
      });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const admin = await Admin.findOne({
      resetPasswordTokenHash: tokenHash,
      resetPasswordExpiresAt: { $gt: new Date() },
    });

    if (!admin) {
      return res.status(400).json({
        message: 'Token inválido ou expirado',
      });
    }

    const hash = await bcrypt.hash(novaSenha, 10);

    admin.senhaHash = hash;
    admin.resetPasswordTokenHash = null;
    admin.resetPasswordExpiresAt = null;

    await admin.save();

    return res.json({
      message: 'Senha atualizada com sucesso',
    });
  } catch (error) {
    console.error('Erro ao resetar senha:', error);
    return res.status(500).json({
      message: 'Erro ao resetar senha',
    });
  }
}

module.exports = {
  login,
  adminGenerateReset,
  resetPassword,
};
