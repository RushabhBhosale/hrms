const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { auth } = require('../middleware/auth');

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user) return res.status(400).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(400).json({ error: 'Invalid credentials' });
  const payload = { id: user._id.toString(), name: user.name, email: user.email, primaryRole: user.primaryRole, subRoles: user.subRoles };
  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '2h' });
  res.json({ token, user: payload });
});

router.get('/me', auth, async (req, res) => {
  const user = await User.findById(req.user.id).lean();
  if (!user) return res.status(404).json({ error: 'Not found' });
  const payload = { id: user._id.toString(), name: user.name, email: user.email, primaryRole: user.primaryRole, subRoles: user.subRoles };
  res.json({ user: payload });
});

module.exports = router;
