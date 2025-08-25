const router = require('express').Router();
const bcrypt = require('bcryptjs');
const Employee = require('../models/Employee');

router.post('/superadmin', async (req, res) => {
  const { name, email, password } = req.body;
  const exists = await Employee.findOne({ email });
  if (exists) return res.json({ ok: true });
  const passwordHash = await bcrypt.hash(password, 10);
  await Employee.create({ name, email, passwordHash, primaryRole: 'SUPERADMIN', subRoles: [] });
  res.json({ ok: true });
});

module.exports = router;
