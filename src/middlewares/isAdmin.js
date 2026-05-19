module.exports = (req, res, next) => {
  const role = req.userRole || req.user?.role;
  if (role !== 'admin' && role !== 'superadmin') {
    console.warn(
      '[AUTHZ] acesso negado: role insuficiente method=%s path=%s ip=%s role=%s',
      req.method,
      req.originalUrl,
      req.ip,
      role || '(none)',
    );
    return res.status(403).json({
      message: 'Acesso restrito a administradores',
    });
  }

  return next();
};
