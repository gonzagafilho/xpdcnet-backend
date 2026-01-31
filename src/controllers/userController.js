const userService = require('../services/userService');
const { ok, noContent } = require('../utils/response');

exports.listUsers = async (req, res, next) => {
  try {
    const users = await userService.listUsers();
    return ok(res, 'Lista de usuários', users);
  } catch (err) {
    return next(err);
  }
};

exports.getUser = async (req, res, next) => {
  try {
    const user = await userService.getUserById(req.params.id);
    return ok(res, 'Usuário encontrado', user);
  } catch (err) {
    return next(err);
  }
};

exports.updateUser = async (req, res, next) => {
  try {
    const user = await userService.updateUser(req.params.id, req.body);
    return ok(res, 'Usuário atualizado', user);
  } catch (err) {
    return next(err);
  }
};

exports.deleteUser = async (req, res, next) => {
  try {
    await userService.deleteUser(req.params.id);
    return noContent(res);
  } catch (err) {
    return next(err);
  }
};

