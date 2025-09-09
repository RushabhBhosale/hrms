const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

const { auth } = require('../middleware/auth');
const { requirePrimary, requireAnySub } = require('../middleware/roles');
const Invoice = require('../models/Invoice');
const Counter = require('../models/Counter');
const Employee = require('../models/Employee');
const Company = require('../models/Company');
const Project = require('../models/Project');
const { sendMail, isEmailEnabled } = require('../utils/mailer');

const upload = multer({ dest: path.join(__dirname, '../../uploads') });

// Helper: allow ADMIN/SUPERADMIN or HR subrole
function allowAdminOrHR(req, res, next) {
  if (!req.employee) return res.status(401).json({ error: 'Unauthorized' });
  const isAdmin = ['ADMIN', 'SUPERADMIN'].includes(req.employee.primaryRole);
  const isHR = (req.employee.subRoles || []).includes('hr');
  if (isAdmin || isHR) return next();
  return res.status(403).json({ error: 'Forbidden' });
}

// Compute totals for invoice line items
function computeTotals(lineItems = []) {
  const normalized = (lineItems || []).map((li) => {
    const qty = Number(li.quantity || 0);
    const rate = Number(li.rate || 0);
    const taxPct = Number(li.taxPercent || 0);
    const base = qty * rate;
    const tax = base * (taxPct / 100);
    return { ...li, quantity: qty, rate, taxPercent: taxPct, total: Math.round((base + tax) * 100) / 100 };
  });
  const subtotal = Math.round(normalized.reduce((s, li) => s + (li.quantity * li.rate), 0) * 100) / 100;
  const taxTotal = Math.round(normalized.reduce((s, li) => s + ((li.quantity * li.rate) * (li.taxPercent / 100)), 0) * 100) / 100;
  const totalAmount = Math.round((subtotal + taxTotal) * 100) / 100;
  return { normalized, subtotal, taxTotal, totalAmount };
}

async function nextInvoiceNumber(companyId) {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const key = `invoice:${companyId}:${ym}`;
  const c = await Counter.findOneAndUpdate(
    { key },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  const seq = String(c.seq).padStart(4, '0');
  return { invoiceNumber: `INV-${ym}-${seq}`, sequenceKey: key };
}

// ---- PDF rendering helpers ----
function safeName(s) {
  return String(s || '').replace(/[^a-z0-9\-_.]+/gi, '_');
}

function drawInvoice(doc, inv) {
  const pageW = doc.page.width;
  const margin = 36;
  const contentW = pageW - margin * 2;
  const PAD = 10;
  const fmt = (n) =>
    Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Header band with logo & company
  const headerY = 24;
  const headerH = 56;
  doc.roundedRect(margin, headerY, contentW, headerH, 8).fill('#F9FAFB');
  doc.fillColor('#111827');
  try {
    const logoFile = inv.company?.logoHorizontal || inv.company?.logo || inv.company?.logoSquare;
    if (logoFile) {
      const logoPath = path.join(__dirname, '../../uploads', String(logoFile));
      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, margin + 10, headerY + 10, { fit: [160, 36], align: 'left', valign: 'center' });
      }
    }
  } catch (_) {}
  doc.font('Helvetica-Bold').fontSize(16).fillColor('#111827');
  doc.text(inv.company?.name || 'Company', margin + 180, headerY + 12, { width: contentW - 190, align: 'right' });

  // Meta
  let y = headerY + headerH + 14;
  doc.font('Helvetica-Bold').fontSize(14).fillColor('#111827');
  doc.text('INVOICE', margin, y);
  doc.font('Helvetica').fontSize(10).fillColor('#6B7280');
  doc.text(`Invoice #: ${inv.invoiceNumber}`, margin, y + 18);
  doc.text(`Issue Date: ${new Date(inv.issueDate).toLocaleDateString('en-GB')}`, margin, y + 33);
  if (inv.dueDate) doc.text(`Due Date: ${new Date(inv.dueDate).toLocaleDateString('en-GB')}`, margin, y + 48);
  if (inv.project) doc.text(`Project: ${inv.project.title || inv.project}`, margin, y + 63);

  // Bill To block with optional client logo
  const billX = margin + contentW - 300;
  const billH = 100;
  doc.roundedRect(billX, y - 6, 300, billH, 8).stroke('#E5E7EB');
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#111827');
  doc.text('Bill To', billX + PAD, y);
  try {
    if (inv.partyLogo) {
      const lp = path.join(__dirname, '../../uploads', String(inv.partyLogo));
      if (fs.existsSync(lp)) doc.image(lp, billX + PAD, y + 18, { fit: [90, 28] });
    }
  } catch (_) {}
  doc.font('Helvetica').fontSize(10).fillColor('#111827');
  doc.text(inv.partyName || '-', billX + PAD, y + 18, { width: 300 - PAD * 2 });
  if (inv.partyEmail) doc.text(inv.partyEmail, billX + PAD, y + 34, { width: 300 - PAD * 2 });
  if (inv.partyAddress) doc.text(inv.partyAddress, billX + PAD, y + 50, { width: 300 - PAD * 2 });

  // Table header
  const tableTop = y + billH + 14;
  const cols = [
    { w: 320, label: 'Description', align: 'left' },
    { w: 60, label: 'Qty', align: 'right' },
    { w: 90, label: 'Rate', align: 'right' },
    { w: 70, label: 'Tax %', align: 'right' },
    { w: 100, label: 'Total', align: 'right' },
  ];
  let x = margin;
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827');
  cols.forEach((c) => { doc.text(c.label, x + PAD, tableTop, { width: c.w - PAD * 2, align: c.align }); x += c.w; });
  doc.moveTo(margin, tableTop + 16).lineTo(margin + contentW, tableTop + 16).stroke('#E5E7EB');

  // Rows with zebra stripes
  doc.font('Helvetica').fontSize(10).fillColor('#111827');
  let ry = tableTop + 24;
  (inv.lineItems || []).forEach((li, idx) => {
    if (idx % 2 === 0) { doc.rect(margin, ry - 4, contentW, 18).fill('#FAFAFA').fillColor('#111827'); }
    let cx = margin;
    const cells = [ String(li.description || ''), String(Number(li.quantity || 0)), fmt(li.rate), String(Number(li.taxPercent || 0)), fmt(li.total) ];
    cells.forEach((val, i) => { doc.text(val, cx + PAD, ry, { width: cols[i].w - PAD * 2, align: cols[i].align }); cx += cols[i].w; });
    ry += 18;
  });

  // Totals box
  const totalsY = ry + 6;
  const boxW = 280;
  const boxX = margin + contentW - boxW;
  doc.roundedRect(boxX, totalsY, boxW, 70, 8).fill('#F9FAFB');
  doc.font('Helvetica').fontSize(10).fillColor('#6B7280');
  doc.text('Subtotal', boxX + PAD, totalsY + 10, { width: boxW - 100 - PAD });
  doc.text('Tax', boxX + PAD, totalsY + 26, { width: boxW - 100 - PAD });
  doc.text('Total', boxX + PAD, totalsY + 42, { width: boxW - 100 - PAD });
  doc.font('Helvetica-Bold').fillColor('#111827');
  doc.text(`${inv.currency} ${fmt(inv.subtotal)}`, boxX + boxW - 100, totalsY + 10, { width: 90, align: 'right' });
  doc.text(`${inv.currency} ${fmt(inv.taxTotal)}`, boxX + boxW - 100, totalsY + 26, { width: 90, align: 'right' });
  doc.fontSize(12).fillColor('#065F46');
  doc.text(`${inv.currency} ${fmt(inv.totalAmount)}`, boxX + boxW - 100, totalsY + 40, { width: 90, align: 'right' });
  doc.fillColor('#111827');

  if (inv.notes) {
    doc.font('Helvetica-Bold').fontSize(11).text('Notes', margin, totalsY);
    doc.font('Helvetica').fontSize(10).fillColor('#111827');
    doc.text(String(inv.notes), margin, totalsY + 16, { width: contentW - boxW - 20 });
  }
}

// Create invoice
router.post('/', auth, allowAdminOrHR, async (req, res) => {
  try {
    const {
      type,
      partyType,
      partyId,
      projectId,
      partyName,
      partyEmail,
      partyAddress,
      issueDate,
      dueDate,
      paymentTerms,
      currency,
      lineItems,
      notes,
      status,
    } = req.body || {};

    if (!['receivable', 'payable'].includes(type)) return res.status(400).json({ error: 'Invalid type' });
    if (!['client', 'employee', 'vendor'].includes(partyType)) return res.status(400).json({ error: 'Invalid partyType' });
    if (!issueDate) return res.status(400).json({ error: 'Missing issueDate' });

    // resolve partyName from employee or project when provided
    let resolvedPartyName = partyName;
    let resolvedPartyId = partyId;
    if (partyType === 'employee' && partyId) {
      const emp = await Employee.findById(partyId).select('name email');
      if (emp) {
        resolvedPartyName = resolvedPartyName || emp.name;
      }
    }
    let resolvedProjectId = projectId;
    if (projectId) {
      const project = await Project.findById(projectId).select('title company');
      if (!project) return res.status(400).json({ error: 'Invalid projectId' });
      if (String(project.company) !== String(req.employee.company)) return res.status(403).json({ error: 'Forbidden project' });
      // If project chosen and no party name, use project title as client name
      resolvedPartyName = resolvedPartyName || project.title;
      // If partyType omitted, default to client for project based invoices
      // (but we still require partyType in validation above; user passed it)
    }

    const { normalized, subtotal, taxTotal, totalAmount } = computeTotals(lineItems);

    const { invoiceNumber, sequenceKey } = await nextInvoiceNumber(req.employee.company);

    const inv = await Invoice.create({
      company: req.employee.company,
      type,
      invoiceNumber,
      sequenceKey,
      partyType,
      partyId: resolvedPartyId || undefined,
      project: resolvedProjectId || undefined,
      partyName: resolvedPartyName || undefined,
      partyEmail: partyEmail || undefined,
      partyAddress: partyAddress || undefined,
      issueDate,
      dueDate,
      paymentTerms,
      currency: currency || 'INR',
      lineItems: normalized,
      subtotal,
      taxTotal,
      totalAmount,
      notes,
      status: status || 'draft',
    });
    res.json({ invoice: inv });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create invoice' });
  }
});

// List invoices with filters
router.get('/', auth, allowAdminOrHR, async (req, res) => {
  try {
    const {
      type,
      status,
      partyType,
      invoiceNumber,
      q,
      from,
      to,
      sortBy,
      sortDir,
      limit,
      offset,
    } = req.query || {};

    const filter = { company: req.employee.company };
    if (type) filter.type = type;
    if (status) filter.status = status;
    if (partyType) filter.partyType = partyType;
    if (invoiceNumber) filter.invoiceNumber = invoiceNumber;
    if (q) {
      filter.$or = [
        { invoiceNumber: { $regex: q, $options: 'i' } },
        { partyName: { $regex: q, $options: 'i' } },
      ];
    }
    if (from || to) {
      filter.issueDate = {};
      if (from) filter.issueDate.$gte = new Date(from);
      if (to) filter.issueDate.$lte = new Date(to);
    }

    const sort = {};
    if (sortBy) {
      sort[sortBy] = String(sortDir || '').toLowerCase() === 'asc' ? 1 : -1;
    } else {
      sort.createdAt = -1;
    }

    const lim = Math.min(Number(limit || 50), 200);
    const off = Math.max(Number(offset || 0), 0);

    const [items, total] = await Promise.all([
      Invoice.find(filter).sort(sort).skip(off).limit(lim).lean(),
      Invoice.countDocuments(filter),
    ]);
    res.json({ items, total });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to list invoices' });
  }
});

// Get one
router.get('/:id', auth, allowAdminOrHR, async (req, res) => {
  const inv = await Invoice.findOne({ _id: req.params.id, company: req.employee.company })
    .populate('project', 'title');
  if (!inv) return res.status(404).json({ error: 'Not found' });
  res.json({ invoice: inv });
});

// Update invoice (including status)
router.put('/:id', auth, allowAdminOrHR, async (req, res) => {
  try {
    const allowed = [
      'partyType', 'partyId', 'partyName', 'partyEmail', 'partyAddress', 'project',
      'issueDate', 'dueDate', 'paymentTerms', 'currency', 'lineItems', 'notes', 'status'
    ];
    const data = {};
    for (const k of allowed) if (k in req.body) data[k] = req.body[k];
    if (data.lineItems) {
      const { normalized, subtotal, taxTotal, totalAmount } = computeTotals(data.lineItems);
      data.lineItems = normalized;
      data.subtotal = subtotal;
      data.taxTotal = taxTotal;
      data.totalAmount = totalAmount;
    }
    const inv = await Invoice.findOneAndUpdate(
      { _id: req.params.id, company: req.employee.company },
      { $set: data },
      { new: true }
    );
    if (!inv) return res.status(404).json({ error: 'Not found' });
    res.json({ invoice: inv });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update invoice' });
  }
});

// Delete invoice
router.delete('/:id', auth, allowAdminOrHR, async (req, res) => {
  const inv = await Invoice.findOneAndDelete({ _id: req.params.id, company: req.employee.company });
  if (!inv) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// Upload attachments (for payable or general docs)
router.post('/:id/attachments', auth, allowAdminOrHR, upload.array('files'), async (req, res) => {
  try {
    const files = (req.files || []).map((f) => f.filename);
    const inv = await Invoice.findOneAndUpdate(
      { _id: req.params.id, company: req.employee.company },
      { $push: { attachments: { $each: files } } },
      { new: true }
    );
    if (!inv) return res.status(404).json({ error: 'Not found' });
    res.json({ invoice: inv });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to upload attachments' });
  }
});

// Upload client (party) logo for this invoice
router.post('/:id/party-logo', auth, allowAdminOrHR, upload.single('logo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const inv = await Invoice.findOneAndUpdate(
      { _id: req.params.id, company: req.employee.company },
      { $set: { partyLogo: req.file.filename } },
      { new: true }
    );
    if (!inv) return res.status(404).json({ error: 'Not found' });
    res.json({ invoice: inv });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to upload logo' });
  }
});

// Generate PDF (on the fly) and stream using drawInvoice
router.get('/:id/pdf', auth, allowAdminOrHR, async (req, res) => {
  const inv = await Invoice.findOne({ _id: req.params.id, company: req.employee.company })
    .populate('company')
    .populate('project', 'title')
    .lean();
  if (!inv) return res.status(404).json({ error: 'Not found' });

  const filename = `Invoice-${safeName(inv.invoiceNumber)}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  const doc = new PDFDocument({ size: 'A4', margins: { top: 36, bottom: 40, left: 36, right: 36 } });
  doc.pipe(res);
  drawInvoice(doc, inv);
  doc.end();
});

// Email PDF
router.post('/:id/email', auth, allowAdminOrHR, async (req, res) => {
  try {
    const inv = await Invoice.findOne({ _id: req.params.id, company: req.employee.company })
      .populate('company')
      .populate('project', 'title');
    if (!inv) return res.status(404).json({ error: 'Not found' });
    const to = req.body?.to || inv.partyEmail;
    if (!to) return res.status(400).json({ error: 'Missing recipient email' });

    // Render PDF to buffer using drawInvoice
    const pdfChunks = [];
    const pdfDoc = new PDFDocument({ size: 'A4', margins: { top: 36, bottom: 40, left: 36, right: 36 } });
    pdfDoc.on('data', (c) => pdfChunks.push(c));
    const pdfDone = new Promise((resolve) => pdfDoc.on('end', resolve));
    drawInvoice(pdfDoc, inv);
    pdfDoc.end();
    await pdfDone;
    const pdfBuffer = Buffer.concat(pdfChunks);

    // Build HTML invoice with logo (CID)
    const logoFile = inv.company?.logoHorizontal || inv.company?.logo || inv.company?.logoSquare;
    const clientLogoFile = inv.partyLogo ? path.join(__dirname, '../../uploads', String(inv.partyLogo)) : null;
    const attachments = [ { filename: `${inv.invoiceNumber}.pdf`, content: pdfBuffer } ];
    if (logoFile) {
      const logoPath = path.join(__dirname, '../../uploads', String(logoFile));
      if (fs.existsSync(logoPath)) attachments.push({ filename: 'logo.png', path: logoPath, cid: 'brandlogo' });
    }
    if (clientLogoFile && fs.existsSync(clientLogoFile)) {
      attachments.push({ filename: 'clientlogo.png', path: clientLogoFile, cid: 'clientlogo' });
    }
    const fmt = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const html = `
      <div style="font-family: -apple-system, Segoe UI, Roboto, Arial; color:#111827;">
        <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 0; border-bottom:1px solid #e5e7eb;">
          <div>${logoFile ? '<img src="cid:brandlogo" alt="logo" style="max-height:40px;" />' : ''}</div>
          <div style="text-align:right;">
            <div style="font-weight:600; font-size:18px;">${inv.company?.name || 'Company'}</div>
            <div style="color:#6b7280; font-size:12px;">Invoice # ${inv.invoiceNumber}</div>
          </div>
        </div>
        <div style="display:flex; justify-content:space-between; padding:12px 0;">
          <div>
            <div style="font-weight:600;">Bill To</div>
            ${clientLogoFile ? '<div><img src="cid:clientlogo" alt="client logo" style="max-height:28px; margin:4px 0;" /></div>' : ''}
            <div>${inv.partyName || '-'}</div>
            ${inv.partyEmail ? `<div style="color:#6b7280; font-size:12px;">${inv.partyEmail}</div>` : ''}
            ${inv.partyAddress ? `<div style="white-space:pre-wrap; color:#6b7280; font-size:12px;">${inv.partyAddress}</div>` : ''}
          </div>
          <div style="text-align:right; color:#374151; font-size:12px;">
            <div>Issue: ${new Date(inv.issueDate).toLocaleDateString('en-GB')}</div>
            ${inv.dueDate ? `<div>Due: ${new Date(inv.dueDate).toLocaleDateString('en-GB')}</div>` : ''}
            ${inv.project ? `<div>Project: ${inv.project.title || inv.project}</div>` : ''}
          </div>
        </div>
        <table style="width:100%; border-collapse:collapse; font-size:13px;">
          <thead>
            <tr style="background:#f9fafb; text-align:left;">
              <th style="padding:8px; border:1px solid #e5e7eb;">Description</th>
              <th style="padding:8px; border:1px solid #e5e7eb; text-align:right;">Qty</th>
              <th style="padding:8px; border:1px solid #e5e7eb; text-align:right;">Rate</th>
              <th style="padding:8px; border:1px solid #e5e7eb; text-align:right;">Tax %</th>
              <th style="padding:8px; border:1px solid #e5e7eb; text-align:right;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${(inv.lineItems || []).map(li => `
              <tr>
                <td style=\"padding:8px; border:1px solid #e5e7eb;\">${li.description || ''}</td>
                <td style=\"padding:8px; border:1px solid #e5e7eb; text-align:right;\">${Number(li.quantity || 0)}</td>
                <td style=\"padding:8px; border:1px solid #e5e7eb; text-align:right;\">${inv.currency} ${fmt(li.rate)}</td>
                <td style=\"padding:8px; border:1px solid #e5e7eb; text-align:right;\">${Number(li.taxPercent || 0)}</td>
                <td style=\"padding:8px; border:1px solid #e5e7eb; text-align:right;\">${inv.currency} ${fmt(li.total)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
        <div style="display:flex; justify-content:flex-end; padding-top:10px;">
          <table style="min-width:280px; border-collapse:collapse;">
            <tr>
              <td style="padding:6px; color:#6b7280;">Subtotal</td>
              <td style="padding:6px; text-align:right;">${inv.currency} ${fmt(inv.subtotal)}</td>
            </tr>
            <tr>
              <td style="padding:6px; color:#6b7280;">Tax</td>
              <td style="padding:6px; text-align:right;">${inv.currency} ${fmt(inv.taxTotal)}</td>
            </tr>
            <tr>
              <td style="padding:6px; font-weight:600;">Total</td>
              <td style="padding:6px; text-align:right; font-weight:700; color:#065F46;">${inv.currency} ${fmt(inv.totalAmount)}</td>
            </tr>
          </table>
        </div>
        ${inv.notes ? `<div style=\"margin-top:12px;\"><div style=\"font-weight:600;\">Notes</div><div style=\"color:#374151;\">${String(inv.notes)}</div></div>` : ''}
        <div style="margin-top:16px; color:#9ca3af; font-size:12px; text-align:center;">This invoice was generated by HRMS</div>
      </div>`;

    const subject = `${inv.company?.name || 'Company'} Invoice ${inv.invoiceNumber}`;
    if (!isEmailEnabled()) return res.status(200).json({ skipped: true, message: 'Email not configured' });
    await sendMail({ to, subject, html, attachments });
    if (inv.status === 'draft') { inv.status = 'sent'; await inv.save(); }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to email invoice' });
  }
});

// Export report (Excel)
router.get('/reports/export', auth, allowAdminOrHR, async (req, res) => {
  try {
    const { from, to, type } = req.query || {};
    const filter = { company: req.employee.company };
    if (type) filter.type = type;
    if (from || to) {
      filter.issueDate = {};
      if (from) filter.issueDate.$gte = new Date(from);
      if (to) filter.issueDate.$lte = new Date(to);
    }
    const items = await Invoice.find(filter).sort({ issueDate: 1 }).lean();

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Invoices');
    ws.columns = [
      { header: 'Invoice #', key: 'invoiceNumber', width: 20 },
      { header: 'Type', key: 'type', width: 12 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Issue Date', key: 'issueDate', width: 18 },
      { header: 'Due Date', key: 'dueDate', width: 18 },
      { header: 'Party', key: 'party', width: 28 },
      { header: 'Amount', key: 'amount', width: 14 },
    ];
    items.forEach((it) => {
      ws.addRow({
        invoiceNumber: it.invoiceNumber,
        type: it.type,
        status: it.status,
        issueDate: it.issueDate ? new Date(it.issueDate).toISOString().slice(0, 10) : '',
        dueDate: it.dueDate ? new Date(it.dueDate).toISOString().slice(0, 10) : '',
        party: it.partyName || '',
        amount: it.totalAmount,
      });
    });

    // Summary sheet
    const ws2 = wb.addWorksheet('Summary');
    const byStatus = items.reduce((m, it) => { m[it.status] = (m[it.status] || 0) + it.totalAmount; return m; }, {});
    ws2.addRow(['Paid', byStatus.paid || 0]);
    ws2.addRow(['Pending/Sent', (byStatus.pending || 0) + (byStatus.sent || 0)]);
    ws2.addRow(['Overdue', byStatus.overdue || 0]);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="invoices.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to export report' });
  }
});

module.exports = router;
