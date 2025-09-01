const router = require('express').Router();
const mongoose = require('mongoose');
const { auth } = require('../middleware/auth');
const { requirePrimary, requireAnySub } = require('../middleware/roles');
const Company = require('../models/Company');
const Employee = require('../models/Employee');
const SalaryTemplate = require('../models/SalaryTemplate');
const SalarySlip = require('../models/SalarySlip');
const PDFDocument = require('pdfkit');
const Attendance = require('../models/Attendance');
const Leave = require('../models/Leave');

function monthValid(m) {
  return typeof m === 'string' && /^\d{4}-\d{2}$/.test(m);
}

// Default locked keys and helpers
const BASIC_KEY = 'basic_earned';
const HRA_KEY = 'hra';
const MEDICAL_KEY = 'medical';
const OTHER_KEY = 'other_allowances';

function defaultLockedFields() {
  return [
    { key: BASIC_KEY, label: 'Basic Earned', type: 'number', required: true, locked: true, category: 'earning', order: 0 },
    { key: HRA_KEY, label: 'HRA', type: 'number', required: true, locked: true, category: 'earning', order: 1 },
    { key: MEDICAL_KEY, label: 'Medical', type: 'number', required: false, locked: true, category: 'earning', order: 2 },
    { key: OTHER_KEY, label: 'Other Allowances', type: 'number', required: false, locked: true, category: 'earning', order: 3 },
  ];
}

function withDefaultSettings(settings) {
  const s = settings || {};
  return {
    basicPercent: Number.isFinite(Number(s.basicPercent)) ? Number(s.basicPercent) : 30,
    hraPercent: Number.isFinite(Number(s.hraPercent)) ? Number(s.hraPercent) : 45,
    medicalAmount: Number.isFinite(Number(s.medicalAmount)) ? Number(s.medicalAmount) : 1500,
  };
}

function ensureTemplateDefaults(tplIn) {
  const tpl = tplIn ? { ...tplIn } : { fields: [] };
  const fields = Array.isArray(tpl.fields) ? [...tpl.fields] : [];
  const existingKeys = new Set(fields.map((f) => f.key));
  const locked = defaultLockedFields();
  const toAdd = locked.filter((f) => !existingKeys.has(f.key));
  const merged = [...locked.map((lf) => ({ ...lf })), ...fields.filter((f) => !locked.some((lf) => lf.key === f.key))];
  return { ...tpl, fields: merged, settings: withDefaultSettings(tpl.settings) };
}

// Get salary template for current company
router.get('/templates', auth, async (req, res) => {
  try {
    const companyId = req.employee.company;
    if (!companyId) return res.status(400).json({ error: 'Company not found' });
    let tpl = await SalaryTemplate.findOne({ company: companyId }).lean();
    if (!tpl) tpl = { company: companyId, fields: [], settings: withDefaultSettings() };
    res.json({ template: ensureTemplateDefaults(tpl) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load template' });
  }
});

// Create/update salary template (Admin only)
router.post('/templates', auth, requirePrimary(['ADMIN', 'SUPERADMIN']), async (req, res) => {
  try {
    const { fields, settings } = req.body || {};
    if (!Array.isArray(fields)) return res.status(400).json({ error: 'Invalid fields' });
    const company = await Company.findOne({ admin: req.employee.id });
    const companyId = company ? company._id : req.employee.company;
    if (!companyId) return res.status(400).json({ error: 'Company not found' });

    const sanitized = fields.map((f, idx) => ({
      key: String(f.key || '').trim() || String(f.label || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
      label: String(f.label || '').trim(),
      type: ['text', 'number', 'date'].includes(f.type) ? f.type : 'text',
      required: !!f.required,
      locked: !!f.locked, // client-provided locked ignored for default keys; kept for any future server-defined fields
      category: ['earning', 'deduction', 'info'].includes(f.category) ? f.category : 'info',
      defaultValue: f.defaultValue,
      order: typeof f.order === 'number' ? f.order : idx,
    })).filter(f => f.label && f.key);

    // Deduplicate keys
    const seen = new Set();
    for (const f of sanitized) {
      if (seen.has(f.key)) return res.status(400).json({ error: `Duplicate key: ${f.key}` });
      seen.add(f.key);
    }

    // Enforce locked defaults and merge
    const locked = defaultLockedFields();
    const custom = sanitized.filter((f) => !locked.some((lf) => lf.key === f.key));
    const mergedFields = [...locked, ...custom].map((f, i) => ({ ...f, order: i }));

    const tpl = await SalaryTemplate.findOneAndUpdate(
      { company: companyId },
      { company: companyId, fields: mergedFields, settings: withDefaultSettings(settings), updatedBy: req.employee.id },
      { upsert: true, new: true }
    );

    res.json({ template: ensureTemplateDefaults(tpl.toObject()) });
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
  if (subs.includes('hr')) return true; // managers should not manage salary slips
  return false;
}

function round2(n) {
  const x = Number(n);
  return Math.round((Number.isFinite(x) ? x : 0) * 100) / 100;
}

function computeLockedValues({ template, employee }) {
  const s = withDefaultSettings(template?.settings);
  const ctc = Number(employee?.ctc) || 0; // monthly CTC
  const basic = round2((ctc * s.basicPercent) / 100);
  const hra = round2((basic * s.hraPercent) / 100);
  const medical = round2(s.medicalAmount);
  // Other allowances = remainder from CTC after the first three
  const remainder = round2(ctc - (basic + hra + medical));
  const other = remainder < 0 ? 0 : remainder;
  return { [BASIC_KEY]: basic, [HRA_KEY]: hra, [MEDICAL_KEY]: medical, [OTHER_KEY]: other };
}

function overlayLocked(values, lockedVals) {
  const out = { ...(values || {}) };
  for (const k of [BASIC_KEY, HRA_KEY, MEDICAL_KEY, OTHER_KEY]) out[k] = lockedVals[k];
  return out;
}

// Get salary slip for an employee + month (self or hr/manager/admin)
router.get('/slips', auth, async (req, res) => {
  try {
    let { employeeId, month } = req.query;
    if (!monthValid(month)) return res.status(400).json({ error: 'Invalid month' });
    if (!employeeId) employeeId = req.employee.id;
    if (!(await canManageFor(req, employeeId))) return res.status(403).json({ error: 'Forbidden' });

    // ensure employee is in same company
    const employee = await Employee.findById(employeeId).select('company ctc');
    if (!employee) return res.status(404).json({ error: 'Employee not found' });
    const companyId = req.employee.company || employee.company;
    if (!companyId || !employee.company.equals(companyId)) return res.status(403).json({ error: 'Forbidden' });

    const [tpl, slip] = await Promise.all([
      SalaryTemplate.findOne({ company: companyId }).lean(),
      SalarySlip.findOne({ employee: employeeId, company: companyId, month }).lean(),
    ]);

    const template = ensureTemplateDefaults(tpl || { company: companyId, fields: [] });
    const rawVals = slip?.values || {};
    const lockedVals = computeLockedValues({ template, employee });
    const values = overlayLocked(rawVals instanceof Map ? Object.fromEntries(rawVals) : rawVals, lockedVals);

    res.json({ template, slip: slip ? { ...slip, values } : { employee: employeeId, company: companyId, month, values } });
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
    const [employee, tpl, slip] = await Promise.all([
      Employee.findById(employeeId).select('ctc'),
      SalaryTemplate.findOne({ company: companyId }).lean(),
      SalarySlip.findOne({ employee: employeeId, company: companyId, month }).lean(),
    ]);
    const template = ensureTemplateDefaults(tpl || { company: companyId, fields: [] });
    const rawVals = slip?.values || {};
    const lockedVals = computeLockedValues({ template, employee });
    const values = overlayLocked(rawVals instanceof Map ? Object.fromEntries(rawVals) : rawVals, lockedVals);
    res.json({ template, slip: slip ? { ...slip, values } : { employee: employeeId, company: companyId, month, values } });
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
        (me.subRoles || []).some((r) => ['hr'].includes(r));
      if (!allowed) return res.status(403).json({ error: 'Forbidden' });

      const employee = await Employee.findById(employeeId).select('company');
      if (!employee) return res.status(404).json({ error: 'Employee not found' });
      const companyId = me.company || employee.company;
      if (!companyId || !employee.company.equals(companyId)) return res.status(403).json({ error: 'Forbidden' });

      const tpl = await SalaryTemplate.findOne({ company: companyId }).lean();
      const template = ensureTemplateDefaults(tpl || {});
      // Only allow non-locked fields to be set by user
      const allowedKeys = new Set((template?.fields || []).filter((f) => !f.locked).map((f) => f.key));

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

      // Return with computed fields overlaid
      const employeeFull = await Employee.findById(employeeId).select('ctc');
      const lockedVals = computeLockedValues({ template, employee: employeeFull });
      const valuesOut = overlayLocked(slip.values instanceof Map ? Object.fromEntries(slip.values) : (slip.values || {}), lockedVals);
      res.json({ slip: { ...slip.toObject(), values: valuesOut } });
    } catch (e) {
      if (e && e.code === 11000) {
        return res.status(409).json({ error: 'Duplicate slip' });
      }
      res.status(500).json({ error: 'Failed to save slip' });
    }
  }
);

module.exports = router;

// ========== PDF generation helpers and routes ==========

// Build a friendly filename
function safeFilename(name) {
  return String(name || 'payslip').replace(/[^a-z0-9\-_.]+/gi, '_');
}

function numberOrZero(v) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Render a salary slip PDF using template + slip values
async function renderSlipPDF({ res, company, employee, month, template, slipValues }) {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 36, bottom: 40, left: 36, right: 36 } });
  const filename = `SalarySlip-${safeFilename(employee?.name)}-${month}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);

  const pageWidth = doc.page.width;
  const margin = doc.page.margins.left;
  const contentWidth = pageWidth - margin * 2;

  const fmtAmount = (n) => `₹${numberOrZero(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const monthStr = (() => {
    const [y, m] = month.split('-').map((x) => parseInt(x, 10));
    const d = new Date(y, m - 1, 1);
    return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  })();

  // Group fields by category using template
  const fields = (template?.fields || []).map((f) => ({ ...f, category: f.category || 'info' }));
  const earnings = fields.filter((f) => f.category === 'earning' && f.type === 'number');
  const deductions = fields.filter((f) => f.category === 'deduction' && f.type === 'number');
  const info = fields.filter((f) => f.category !== 'earning' && f.category !== 'deduction');
  const sum = (list) => list.reduce((acc, f) => acc + numberOrZero(slipValues[f.key]), 0);
  const totalEarnings = sum(earnings);
  const totalDeductions = sum(deductions);
  const netPay = totalEarnings - totalDeductions;

  // Header: company left, period right
  doc.font('Helvetica-Bold').fontSize(16).text(company?.name || 'Company', margin, doc.y, { width: contentWidth / 2 });
  doc.font('Helvetica').fontSize(10).text(`Payslip For the Month`, margin + contentWidth / 2, 36, { width: contentWidth / 2, align: 'right' });
  doc.font('Helvetica-Bold').fontSize(12).text(monthStr.toUpperCase(), margin + contentWidth / 2, 50, { width: contentWidth / 2, align: 'right' });
  doc.moveDown(1.5);

  // Employee summary box
  const yStart = doc.y;
  const leftW = Math.floor((contentWidth * 2) / 3) - 8;
  const rightW = contentWidth - leftW - 16;
  const xLeft = margin;
  const xRight = margin + leftW + 16;

  // Left summary
  const lineH = 16;
  let y = yStart;
  doc.roundedRect(xLeft, y, leftW, 120, 8).stroke('#E5E7EB');
  doc.font('Helvetica-Bold').fontSize(11).text('EMPLOYEE SUMMARY', xLeft + 10, y + 8);
  const pairs = [
    ['Employee Name', employee?.name || '-'],
    ['Designation', slipValues['designation'] || '-'],
    ['Employee ID', employee?.employeeId || '-'],
    ['Date of Joining', slipValues['date_of_joining'] || '-'],
    ['Pay Period', monthStr],
    ['Pay Date', slipValues['pay_date'] || lastDayOfMonthString(month)],
  ];
  let yy = y + 28;
  pairs.forEach(([k, v]) => {
    doc.font('Helvetica').fontSize(10).fillColor('#6B7280').text(`${k}`, xLeft + 10, yy);
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text(`:    ${String(v)}`, xLeft + 115, yy);
    yy += lineH;
  });
  doc.fillColor('#000');

  // Right: Net Pay box and paid/lop days
  doc.roundedRect(xRight, y, rightW, 120, 8).stroke('#E5E7EB');
  // Net pay banner
  doc.roundedRect(xRight + 10, y + 10, rightW - 20, 54, 8).fill('#D1FAE5');
  doc.fillColor('#065F46').font('Helvetica-Bold').fontSize(16).text(fmtAmount(netPay), xRight + 16, y + 24, { width: rightW - 32, align: 'center' });
  doc.fillColor('#065F46').font('Helvetica').fontSize(10).text('Employee Net Pay', xRight + 16, y + 44, { width: rightW - 32, align: 'center' });

  const paidDays = slipValues['paid_days'] ?? '';
  const lopDays = slipValues['lop_days'] ?? '';
  // small info panel
  const smallY = y + 70;
  doc.roundedRect(xRight + 10, smallY, rightW - 20, 36, 6).stroke('#E5E7EB');
  doc.font('Helvetica').fontSize(10).fillColor('#6B7280').text('Paid Days', xRight + 18, smallY + 8);
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827').text(String(paidDays || '-'), xRight + 18, smallY + 20);
  doc.font('Helvetica').fontSize(10).fillColor('#6B7280').text('LOP Days', xRight + (rightW / 2), smallY + 8, { width: rightW / 2 - 26 });
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827').text(String(lopDays || '-'), xRight + (rightW / 2), smallY + 20, { width: rightW / 2 - 26 });
  doc.fillColor('#000');

  doc.moveDown(8 / lineH);
  doc.y = y + 132;

  // PF/UAN row
  const pf = slipValues['pf_ac_number'] || '-';
  const uan = slipValues['uan'] || '-';
  doc.font('Helvetica').fontSize(10).fillColor('#6B7280').text('PF A/C Number', xLeft, doc.y);
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text(`:  ${pf}`, xLeft + 100, doc.y);
  doc.font('Helvetica').fontSize(10).fillColor('#6B7280').text('UAN', xLeft + leftW - 120, doc.y, { width: 100, align: 'right' });
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text(`:  ${uan}`, xLeft + leftW - 16, doc.y, { width: 140 });
  doc.fillColor('#000');

  doc.moveDown(0.8);

  // Tables
  const colWidth = Math.floor(contentWidth / 2) - 10;
  const xTableLeft = margin;
  const xTableRight = margin + colWidth + 20;
  let yTable = doc.y + 8;

  function tableHeader(title, startX, startY) {
    doc.roundedRect(startX, startY, colWidth, 24, 6).fill('#F3F4F6');
    doc.fillColor('#111827').font('Helvetica-Bold').fontSize(11).text(title.toUpperCase(), startX + 10, startY + 6, { width: colWidth - 20 });
    doc.fillColor('#6B7280').font('Helvetica').fontSize(9).text('AMOUNT', startX + colWidth - 150, startY + 7, { width: 70, align: 'right' });
    doc.text('YTD', startX + colWidth - 70, startY + 7, { width: 60, align: 'right' });
    doc.fillColor('#000');
  }

  function drawRows(items, startX, startY, ytd) {
    let y = startY + 28;
    doc.font('Helvetica').fontSize(10);
    if (!items.length) {
      doc.text('—', startX + 10, y);
      y += 16;
    } else {
      items.forEach((f) => {
        const amount = numberOrZero(slipValues[f.key]);
        const ytdVal = numberOrZero(ytd[f.key]);
        const label = f.label || f.key;
        doc.fillColor('#111827').text(label, startX + 10, y, { width: colWidth - 170 });
        doc.fillColor('#111827').text(fmtAmount(amount), startX + colWidth - 150, y, { width: 70, align: 'right' });
        doc.fillColor('#6B7280').text(fmtAmount(ytdVal), startX + colWidth - 70, y, { width: 60, align: 'right' });
        y += 16;
        doc.fillColor('#000');
      });
    }
    return y;
  }

  // Compute YTD by summing slips in the same year up to current month
  const [year, m] = month.split('-').map((x) => parseInt(x, 10));
  const ytdMap = await computeYTD(employee._id || employee.id, company._id || company.id, year, m);
  const ytdEarnings = ytdMap; // same map, filtered by fields on render
  const ytdDeductions = ytdMap;

  tableHeader('Earnings', xTableLeft, yTable);
  const yAfterEarn = drawRows(earnings, xTableLeft, yTable, ytdEarnings);
  tableHeader('Deductions', xTableRight, yTable);
  const yAfterDed = drawRows(deductions, xTableRight, yTable, ytdDeductions);
  yTable = Math.max(yAfterEarn, yAfterDed) + 6;

  // Totals row bars
  doc.roundedRect(xTableLeft, yTable, colWidth, 26, 6).fill('#F9FAFB');
  doc.fillColor('#111827').font('Helvetica-Bold').fontSize(10).text('Gross Earnings', xTableLeft + 10, yTable + 7, { width: colWidth - 150 });
  doc.text(fmtAmount(totalEarnings), xTableLeft + colWidth - 150, yTable + 7, { width: 70, align: 'right' });
  doc.fillColor('#6B7280').font('Helvetica').fontSize(9).text('Total Deductions', xTableRight + 10, yTable + 7, { width: colWidth - 40 });
  doc.fillColor('#111827').font('Helvetica-Bold').fontSize(10).text(fmtAmount(totalDeductions), xTableRight + colWidth - 80, yTable + 7, { width: 70, align: 'right' });
  doc.fillColor('#000');

  // Net payable highlight
  const yNet = yTable + 36;
  doc.roundedRect(margin, yNet, contentWidth, 36, 8).stroke('#E5E7EB');
  doc.font('Helvetica-Bold').fontSize(11).text('TOTAL NET PAYABLE', margin + 10, yNet + 10);
  doc.font('Helvetica').fontSize(9).fillColor('#6B7280').text('Gross Earnings - Total Deductions', margin + 160, yNet + 11);
  doc.fillColor('#065F46');
  doc.font('Helvetica-Bold').fontSize(12).text(fmtAmount(netPay), margin + contentWidth - 140, yNet + 9, { width: 130, align: 'right' });
  doc.fillColor('#000');

  // Amount in words
  doc.moveDown(2);
  doc.font('Helvetica').fontSize(10).fillColor('#6B7280').text(`Amount In Words : ${amountInWordsIndian(Math.round(netPay))} Only`);
  doc.fillColor('#9CA3AF').fontSize(8).text('— This payslip is system generated and does not require a signature —', { align: 'center' });

  doc.end();
}

function lastDayOfMonthString(month) {
  const [y, m] = month.split('-').map((x) => parseInt(x, 10));
  const d = new Date(y, m, 0);
  return d.toLocaleDateString('en-GB');
}

async function computeYTD(employeeId, companyId, year, uptoMonth) {
  const prefix = `${year}-`;
  const slips = await SalarySlip.find({ employee: employeeId, company: companyId, month: { $regex: `^${prefix}` } }).lean();
  const map = {};
  for (const s of slips) {
    const [yy, mm] = String(s.month || '').split('-').map((x) => parseInt(x, 10));
    if (yy !== year || !mm || mm > uptoMonth) continue;
    const entries = s.values instanceof Map ? Array.from(s.values.entries()) : Object.entries(s.values || {});
    for (const [k, v] of entries) {
      const n = numberOrZero(v);
      map[k] = numberOrZero(map[k]) + n;
    }
  }
  return map;
}

// Minimal number to words for Indian system
function amountInWordsIndian(num) {
  if (!Number.isFinite(num)) return '-';
  if (num === 0) return 'Zero';
  const belowTwenty = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  function two(n){ if(n<20) return belowTwenty[n]; const t=Math.floor(n/10);const r=n%10; return tens[t]+(r? ' '+belowTwenty[r]:''); }
  function three(n){ if(n===0) return ''; if(n<100) return two(n); const h=Math.floor(n/100);const r=n%100; return belowTwenty[h]+' Hundred'+(r?' '+two(r):''); }
  let out='';
  const crore=Math.floor(num/10000000); num%=10000000;
  const lakh=Math.floor(num/100000); num%=100000;
  const thousand=Math.floor(num/1000); num%=1000;
  const hundred=num;
  if(crore) out += three(crore)+' Crore ';
  if(lakh) out += three(lakh)+' Lakh ';
  if(thousand) out += two(thousand)+' Thousand ';
  if(hundred) out += three(hundred);
  return out.trim();
}

// Download PDF for selected employee (admin/hr/manager or self if matches)
router.get('/slips/pdf', auth, async (req, res) => {
  try {
    let { employeeId, month } = req.query;
    if (!monthValid(month)) return res.status(400).json({ error: 'Invalid month' });
    if (!employeeId) employeeId = req.employee.id;
    if (!(await canManageFor(req, employeeId))) return res.status(403).json({ error: 'Forbidden' });

    const employee = await Employee.findById(employeeId).select('name email employeeId company');
    if (!employee) return res.status(404).json({ error: 'Employee not found' });
    const companyId = req.employee.company || employee.company;
    if (!companyId || !employee.company.equals(companyId)) return res.status(403).json({ error: 'Forbidden' });

    const [company, templateRaw, slip] = await Promise.all([
      Company.findById(companyId).lean(),
      SalaryTemplate.findOne({ company: companyId }).lean(),
      SalarySlip.findOne({ employee: employeeId, company: companyId, month }).lean(),
    ]);
    const template = ensureTemplateDefaults(templateRaw || {});
    const valuesObj = {};
    const raw = slip?.values || {};
    const entries = raw instanceof Map ? Array.from(raw.entries()) : Object.entries(raw);
    for (const [k, v] of entries) valuesObj[k] = v;
    const lockedVals = computeLockedValues({ template, employee });
    const finalVals = overlayLocked(valuesObj, lockedVals);

    await renderSlipPDF({ res, company, employee, month, template, slipValues: finalVals });
  } catch (e) {
    console.error('payslip pdf error', e);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

// Self shortcut: download my slip
router.get('/slips/mine/pdf', auth, async (req, res) => {
  try {
    const { month } = req.query;
    if (!monthValid(month)) return res.status(400).json({ error: 'Invalid month' });
    const employeeId = req.employee.id;
    const companyId = req.employee.company;
    if (!companyId) return res.status(400).json({ error: 'Company not found' });

    const [employee, company, templateRaw, slip] = await Promise.all([
      Employee.findById(employeeId).select('name email employeeId company'),
      Company.findById(companyId).lean(),
      SalaryTemplate.findOne({ company: companyId }).lean(),
      SalarySlip.findOne({ employee: employeeId, company: companyId, month }).lean(),
    ]);
    const template = ensureTemplateDefaults(templateRaw || {});
    const valuesObj = {};
    const raw = slip?.values || {};
    const entries = raw instanceof Map ? Array.from(raw.entries()) : Object.entries(raw);
    for (const [k, v] of entries) valuesObj[k] = v;
    const lockedVals = computeLockedValues({ template, employee: await Employee.findById(employeeId).select('ctc') });
    const finalVals = overlayLocked(valuesObj, lockedVals);

    await renderSlipPDF({ res, company, employee, month, template, slipValues: finalVals });
  } catch (e) {
    console.error('my payslip pdf error', e);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});
