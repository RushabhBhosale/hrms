const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { auth } = require('../middleware/auth');
const Company = require('../models/Company');
const User = require('../models/User');

// Create company with an admin user
router.post('/', auth, async (req, res) => {
  if (req.user.primaryRole !== 'SUPERADMIN') return res.status(403).json({ error: 'Forbidden' });
  const { companyName, adminName, adminEmail, adminPassword } = req.body;
  if (!companyName || !adminName || !adminEmail || !adminPassword) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  let admin = await User.findOne({ email: adminEmail });
  if (admin) return res.status(400).json({ error: 'Admin already exists' });
  const passwordHash = await bcrypt.hash(adminPassword, 10);
  admin = await User.create({ name: adminName, email: adminEmail, passwordHash, primaryRole: 'ADMIN', subRoles: [] });
  const company = await Company.create({ name: companyName, admin: admin._id });
  res.json({ company });
});

// List companies with admins
router.get('/', auth, async (req, res) => {
  if (req.user.primaryRole !== 'SUPERADMIN') return res.status(403).json({ error: 'Forbidden' });
  const companies = await Company.find().populate('admin', 'name email');
  res.json({ companies });
});

module.exports = router;
