const router = require('express').Router();
const mongoose = require('mongoose');
const { auth } = require('../middleware/auth');
const { requirePrimary, requireAnySub } = require('../middleware/roles');
const Company = require('../models/Company');
const Employee = require('../models/Employee');
const SalaryTemplate = require('../models/SalaryTemplate');
const SalarySlip = require('../models/SalarySlip');

function monthValid(m) {
  return typeof m === 'string' && /^\d{4}-\d{2}$/.test(m);
}

// Get salary template for current company
router.get('/templates', auth, async (req, res) => {
  try {
    const companyId = req.employee.company;
    if (!companyId) return res.status(400).json({ error: 'Company not found' });
    let tpl = await SalaryTemplate.findOne({ company: companyId }).lean();
    if (!tpl) tpl = { company: companyId, fields: [] };
    res.json({ template: tpl });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load template' });
  }
});

// Create/update salary template (Admin only)
router.post('/templates', auth, requirePrimary(['ADMIN', 'SUPERADMIN']), async (req, res) => {
  try {
    const { fields } = req.body || {};
    if (!Array.isArray(fields)) return res.status(400).json({ error: 'Invalid fields' });
    const company = await Company.findOne({ admin: req.employee.id });
    const companyId = company ? company._id : req.employee.company;
    if (!companyId) return res.status(400).json({ error: 'Company not found' });

    const sanitized = fields.map((f, idx) => ({
      key: String(f.key || '').trim() || String(f.label || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
      label: String(f.label || '').trim(),
      type: ['text', 'number', 'date'].includes(f.type) ? f.type : 'text',
      required: !!f.required,
      defaultValue: f.defaultValue,
      order: typeof f.order === 'number' ? f.order : idx,
    })).filter(f => f.label && f.key);

    // Deduplicate keys
    const seen = new Set();
    for (const f of sanitized) {
      if (seen.has(f.key)) return res.status(400).json({ error: `Duplicate key: ${f.key}` });
      seen.add(f.key);
    }

    const tpl = await SalaryTemplate.findOneAndUpdate(
      { company: companyId },
      { company: companyId, fields: sanitized, updatedBy: req.employee.id },
      { upsert: true, new: true }
    );

    res.json({ template: tpl });
  } catch (e) {
    res.status(500).json({ error: 'Failed to save template' });
  }
});

// Helper to authorize managers/hr/admin to manage slips for others
async function canManageFor(req, employeeId) {
  if (!employeeId) return false;
  const me = req.employee;
  if (!me) return false;
  // self is always OK for view
  if (String(me.id) === String(employeeId)) return true;
  if (['ADMIN', 'SUPERADMIN'].includes(me.primaryRole)) return true;
  const subs = me.subRoles || [];
  if (subs.includes('hr') || subs.includes('manager')) return true;
  return false;
}

// Get salary slip for an employee + month (self or hr/manager/admin)
router.get('/slips', auth, async (req, res) => {
  try {
    let { employeeId, month } = req.query;
    if (!monthValid(month)) return res.status(400).json({ error: 'Invalid month' });
    if (!employeeId) employeeId = req.employee.id;
    if (!(await canManageFor(req, employeeId))) return res.status(403).json({ error: 'Forbidden' });

    // ensure employee is in same company
    const employee = await Employee.findById(employeeId).select('company');
    if (!employee) return res.status(404).json({ error: 'Employee not found' });
    const companyId = req.employee.company || employee.company;
    if (!companyId || !employee.company.equals(companyId)) return res.status(403).json({ error: 'Forbidden' });

    const [tpl, slip] = await Promise.all([
      SalaryTemplate.findOne({ company: companyId }).lean(),
      SalarySlip.findOne({ employee: employeeId, company: companyId, month }).lean(),
    ]);

    res.json({ template: tpl || { company: companyId, fields: [] }, slip: slip || null });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load slip' });
  }
});

// Shortcut for self
router.get('/slips/mine', auth, async (req, res) => {
  try {
    const { month } = req.query;
    if (!monthValid(month)) return res.status(400).json({ error: 'Invalid month' });
    const employeeId = req.employee.id;
    const companyId = req.employee.company;
    if (!companyId) return res.status(400).json({ error: 'Company not found' });
    const [tpl, slip] = await Promise.all([
      SalaryTemplate.findOne({ company: companyId }).lean(),
      SalarySlip.findOne({ employee: employeeId, company: companyId, month }).lean(),
    ]);
    res.json({ template: tpl || { company: companyId, fields: [] }, slip: slip || null });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load slip' });
  }
});

// Create/update salary slip (admin/hr/manager)
router.post(
  '/slips',
  auth,
  async (req, res) => {
    try {
      const { employeeId, month, values } = req.body || {};
      if (!employeeId || !monthValid(month) || typeof values !== 'object')
        return res.status(400).json({ error: 'Invalid payload' });

      const me = req.employee;
      const allowed =
        ['ADMIN', 'SUPERADMIN'].includes(me.primaryRole) ||
        (me.subRoles || []).some((r) => ['hr', 'manager'].includes(r));
      if (!allowed) return res.status(403).json({ error: 'Forbidden' });

      const employee = await Employee.findById(employeeId).select('company');
      if (!employee) return res.status(404).json({ error: 'Employee not found' });
      const companyId = me.company || employee.company;
      if (!companyId || !employee.company.equals(companyId)) return res.status(403).json({ error: 'Forbidden' });

      const tpl = await SalaryTemplate.findOne({ company: companyId }).lean();
      const allowedKeys = new Set((tpl?.fields || []).map((f) => f.key));

      // sanitize values to template keys only
      const sanitized = {};
      for (const k of Object.keys(values || {})) {
        if (allowedKeys.has(k)) sanitized[k] = values[k];
      }

      // Optionally enforce required fields
      const missing = (tpl?.fields || [])
        .filter((f) => f.required)
        .filter((f) => sanitized[f.key] === undefined || sanitized[f.key] === null || sanitized[f.key] === '')
        .map((f) => f.key);
      if (missing.length) return res.status(400).json({ error: 'Missing required fields', missing });

      const slip = await SalarySlip.findOneAndUpdate(
        { employee: employeeId, company: companyId, month },
        { $set: { values: sanitized, updatedBy: me.id }, $setOnInsert: { createdBy: me.id } },
        { upsert: true, new: true }
      );

      res.json({ slip });
    } catch (e) {
      if (e && e.code === 11000) {
        return res.status(409).json({ error: 'Duplicate slip' });
      }
      res.status(500).json({ error: 'Failed to save slip' });
    }
  }
);

module.exports = router;
