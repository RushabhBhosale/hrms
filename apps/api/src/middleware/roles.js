function requirePrimary(roles) {
  return (req, res, next) => {
    if (!req.employee) return res.status(401).json({ error: 'Unauthorized' });
    if (roles.includes(req.employee.primaryRole)) return next();
    return res.status(403).json({ error: 'Forbidden' });
  };
}

function requireAnySub(subs) {
  return (req, res, next) => {
    if (!req.employee) return res.status(401).json({ error: 'Unauthorized' });
    const ok = (req.employee.subRoles || []).some(r => subs.includes(r));
    if (ok) return next();
    return res.status(403).json({ error: 'Forbidden' });
  };
}

module.exports = { requirePrimary, requireAnySub };
