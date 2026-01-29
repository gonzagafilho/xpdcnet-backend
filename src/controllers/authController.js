const authService = require('../services/authService');
const { ok, created } = require('../utils/response');

/**
 * REGISTER
 * Criação de usuário (delegado ao service)
 */
exports.register = async (req, res, next) => {
  try {
    const result = await authService.register(req.body);

    return created(res, 'Usuário criado com sucesso', result);
  } catch (err) {
    return next(err);
  }
};

/**
 * LOGIN
 * Autenticação com JWT (delegado ao service)
 */
exports.login = async (req, res, next) => {
  try {
    const result = await authService.login(req.body);

    return ok(res, 'Login realizado com sucesso', result);
  } catch (err) {
    return next(err);
  }
};

/**
 * ME
 * Retorna dados do usuário autenticado (delegado ao service)
 */
exports.me = async (req, res, next) => {
  try {
    // ✅ compatível com seu middleware atual:
    const userId = req.userId;

    // ✅ se você já atualizou o authMiddleware para req.user.id, use isso:
    // const userId = req.user?.id;

    const result = await authService.me({ userId });

    return ok(res, 'Usuário autenticado', result);
  } catch (err) {
    return next(err);
  }
};
