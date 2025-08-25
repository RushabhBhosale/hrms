const router = require('express').Router();
const bcrypt = require('bcryptjs');
const User = require('../models/User');

router.post('/superadmin', async (req, res) => {
  const { name, email, password } = req.body;
  const exists = await User.findOne({ email });
  if (exists) return res.json({ ok: true });
  const passwordHash = await bcrypt.hash(password, 10);
  await User.create({ name, email, passwordHash, primaryRole: 'SUPERADMIN', subRoles: [] });
  res.json({ ok: true });
});

module.exports = router;
