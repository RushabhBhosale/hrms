function requirePrimary(roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (roles.includes(req.user.primaryRole)) return next();
    return res.status(403).json({ error: 'Forbidden' });
  };
}

function requireAnySub(subs) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const ok = (req.user.subRoles || []).some(r => subs.includes(r));
    if (ok) return next();
    return res.status(403).json({ error: 'Forbidden' });
  };
}

module.exports = { requirePrimary, requireAnySub };
