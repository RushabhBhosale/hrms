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
  admin.company = company._id;
  await admin.save();
  res.json({ company });
});

// List companies with admins
router.get('/', auth, async (req, res) => {
  if (req.user.primaryRole !== 'SUPERADMIN') return res.status(403).json({ error: 'Forbidden' });
  const companies = await Company.find().populate('admin', 'name email');
  res.json({ companies });
});

// Admin: create user in their company
router.post('/users', auth, async (req, res) => {
  if (!['ADMIN', 'SUPERADMIN'].includes(req.user.primaryRole)) return res.status(403).json({ error: 'Forbidden' });
  const { name, email, password, role } = req.body;
  if (!name || !email || !password || !role) return res.status(400).json({ error: 'Missing fields' });
  const company = await Company.findOne({ admin: req.user.id });
  if (!company) return res.status(400).json({ error: 'Company not found' });
  let existing = await User.findOne({ email });
  if (existing) return res.status(400).json({ error: 'User already exists' });
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({ name, email, passwordHash, primaryRole: 'USER', subRoles: [role], company: company._id });
  res.json({ user: { id: user._id, name: user.name, email: user.email, subRoles: user.subRoles } });
});

// Admin: list users in their company
router.get('/users', auth, async (req, res) => {
  if (!['ADMIN', 'SUPERADMIN'].includes(req.user.primaryRole)) return res.status(403).json({ error: 'Forbidden' });
  const company = await Company.findOne({ admin: req.user.id });
  if (!company) return res.status(400).json({ error: 'Company not found' });
  const users = await User.find({ company: company._id }).select('name email subRoles').lean();
  res.json({ users: users.map(u => ({ id: u._id, name: u.name, email: u.email, subRoles: u.subRoles })) });
});

module.exports = router;
