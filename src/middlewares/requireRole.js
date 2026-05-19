function requireRole(roles = []) {
  return (req, res, next) => {
    const role = req.user && req.user.role;

    if (!role) {
      return res.status(401).json({ ok: false, error: "Não autenticado" });
    }

    if (!roles.includes(role)) {
      return res.status(403).json({ ok: false, error: "Sem permissão" });
    }

    next();
  };
}

module.exports = requireRole;