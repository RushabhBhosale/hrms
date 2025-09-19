const router = require("express").Router();
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const PDFDocument = require("pdfkit");
const ExcelJS = require("exceljs");

const { auth } = require("../middleware/auth");
const { requirePrimary, requireAnySub } = require("../middleware/roles");
const Invoice = require("../models/Invoice");
const Counter = require("../models/Counter");
const Employee = require("../models/Employee");
const Company = require("../models/Company");
const Project = require("../models/Project");
const { sendMail, isEmailEnabled } = require("../utils/mailer");

const upload = multer({ dest: path.join(__dirname, "../../uploads") });

// Helper: allow ADMIN/SUPERADMIN or HR subrole
function allowAdminOrHR(req, res, next) {
  if (!req.employee) return res.status(401).json({ error: "Unauthorized" });
  const isAdmin = ["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole);
  const isHR = (req.employee.subRoles || []).includes("hr");
  if (isAdmin || isHR) return next();
  return res.status(403).json({ error: "Forbidden" });
}

// Compute totals for invoice line items
function computeTotals(lineItems = []) {
  const normalized = (Array.isArray(lineItems) ? lineItems : [])
    .map((li) => {
      if (!li) return null;
      const description = String(li.description || "").trim();
      if (!description) return null;
      const qtyNum = Number(li.quantity);
      const rateNum = Number(li.rate);
      const taxNum = Number(li.taxPercent);
      const qty = Number.isFinite(qtyNum) && qtyNum > 0 ? qtyNum : 0;
      const rate = Number.isFinite(rateNum) && rateNum > 0 ? rateNum : 0;
      const taxPercent = Number.isFinite(taxNum)
        ? Math.min(Math.max(taxNum, 0), 100)
        : 0;
      const base = qty * rate;
      const tax = base * (taxPercent / 100);
      return {
        ...li,
        description,
        quantity: qty,
        rate,
        taxPercent,
        total: Math.round((base + tax) * 100) / 100,
      };
    })
    .filter(Boolean);
  const subtotal =
    Math.round(
      normalized.reduce((s, li) => s + li.quantity * li.rate, 0) * 100
    ) / 100;
  const taxTotal =
    Math.round(
      normalized.reduce(
        (s, li) => s + li.quantity * li.rate * (li.taxPercent / 100),
        0
      ) * 100
    ) / 100;
  const totalAmount = Math.round((subtotal + taxTotal) * 100) / 100;
  return { normalized, subtotal, taxTotal, totalAmount };
}

async function nextInvoiceNumber(companyId) {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(
    2,
    "0"
  )}`;
  const key = `invoice:${companyId}:${ym}`;
  const c = await Counter.findOneAndUpdate(
    { key },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  const seq = String(c.seq).padStart(4, "0");
  return { invoiceNumber: `INV-${ym}-${seq}`, sequenceKey: key };
}

// ---- PDF rendering helpers ----
function safeName(s) {
  return String(s || "").replace(/[^a-z0-9\-_.]+/gi, "_");
}

function drawInvoice(doc, inv) {
  const pageW = doc.page.width;
  const margin = 36;
  const contentW = pageW - margin * 2;
  const PAD = 10;
  const currencyCode = inv.currency || "INR";
  const fmt = (n) =>
    Number(n || 0).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  // Header band with logo & company
  const headerY = 24;
  const headerH = 56;
  doc.roundedRect(margin, headerY, contentW, headerH, 8).fill("#F9FAFB");
  doc.fillColor("#111827");
  try {
    const logoFile =
      inv.company?.logoHorizontal ||
      inv.company?.logo ||
      inv.company?.logoSquare;
    if (logoFile) {
      const logoPath = path.join(__dirname, "../../uploads", String(logoFile));
      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, margin + 10, headerY + 10, {
          fit: [160, 36],
          align: "left",
          valign: "center",
        });
      }
    }
  } catch (_) {}
  doc.font("Helvetica-Bold").fontSize(16).fillColor("#111827");
  doc.text(inv.company?.name || "Company", margin + 180, headerY + 12, {
    width: contentW - 190,
    align: "right",
  });

  // Meta
  let y = headerY + headerH + 14;
  doc.font("Helvetica-Bold").fontSize(14).fillColor("#111827");
  doc.text("INVOICE", margin, y);
  doc.font("Helvetica").fontSize(10).fillColor("#6B7280");
  doc.text(`Invoice #: ${inv.invoiceNumber}`, margin, y + 18);
  doc.text(
    `Issue Date: ${new Date(inv.issueDate).toLocaleDateString("en-GB")}`,
    margin,
    y + 33
  );
  if (inv.dueDate)
    doc.text(
      `Due Date: ${new Date(inv.dueDate).toLocaleDateString("en-GB")}`,
      margin,
      y + 48
    );
  if (inv.project)
    doc.text(`Project: ${inv.project.title || inv.project}`, margin, y + 63);

  // Bill To block with optional client logo
  const billX = margin + contentW - 300;
  const billH = 100;
  doc.roundedRect(billX, y - 6, 300, billH, 8).stroke("#E5E7EB");
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#111827");
  doc.text("Bill To", billX + PAD, y);
  try {
    if (inv.partyLogo) {
      const lp = path.join(__dirname, "../../uploads", String(inv.partyLogo));
      if (fs.existsSync(lp))
        doc.image(lp, billX + PAD, y + 18, { fit: [90, 28] });
    }
  } catch (_) {}
  doc.font("Helvetica").fontSize(10).fillColor("#111827");
  doc.text(inv.partyName || "-", billX + PAD, y + 18, { width: 300 - PAD * 2 });
  if (inv.partyEmail)
    doc.text(inv.partyEmail, billX + PAD, y + 34, { width: 300 - PAD * 2 });
  if (inv.partyAddress)
    doc.text(inv.partyAddress, billX + PAD, y + 50, { width: 300 - PAD * 2 });

  // Table header
  const tableTop = y + billH + 14;
  const cols = [
    { w: 320, label: "Description", align: "left" },
    { w: 60, label: "Qty", align: "right" },
    { w: 90, label: "Rate", align: "right" },
    { w: 70, label: "Tax %", align: "right" },
    { w: 100, label: "Line Total", align: "right" },
  ];
  let x = margin;
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#111827");
  cols.forEach((c) => {
    doc.text(c.label, x + PAD, tableTop, {
      width: c.w - PAD * 2,
      align: c.align,
    });
    x += c.w;
  });
  doc
    .moveTo(margin, tableTop + 16)
    .lineTo(margin + contentW, tableTop + 16)
    .stroke("#E5E7EB");

  // Rows with zebra stripes
  doc.font("Helvetica").fontSize(10).fillColor("#111827");
  let ry = tableTop + 24;
  const baseRowHeight = 18;
  (inv.lineItems || []).forEach((li, idx) => {
    const quantity = Number(li.quantity || 0);
    const rate = Number(li.rate || 0);
    const taxPercent = Math.min(Math.max(Number(li.taxPercent || 0), 0), 100);
    const lineSubtotal = quantity * rate;
    const lineTotal =
      li.total !== undefined && li.total !== null && !Number.isNaN(li.total)
        ? Number(li.total)
        : lineSubtotal * (1 + taxPercent / 100);
    const roundedLineTotal = Math.round(lineTotal * 100) / 100;

    const description = String(li.description || "").replace(/\r\n/g, "\n");
    const descHeight = doc.heightOfString(description, {
      width: cols[0].w - PAD * 2,
      align: "left",
    });
    const rowHeight = Math.max(baseRowHeight, descHeight + 8);
    const rowTop = ry;

    if (idx % 2 === 0) {
      doc.rect(margin, rowTop, contentW, rowHeight).fill("#FAFAFA");
      doc.fillColor("#111827");
    }

    let cx = margin;
    const cells = [
      description,
      fmt(quantity),
      fmt(rate),
      fmt(taxPercent),
      `${currencyCode} ${fmt(roundedLineTotal)}`,
    ];

    cells.forEach((val, i) => {
      doc.text(val, cx + PAD, rowTop, {
        width: cols[i].w - PAD * 2,
        align: cols[i].align,
        lineBreak: true,
        height: rowHeight,
      });
      cx += cols[i].w;
    });
    ry += rowHeight;
  });

  // Totals box
  const totalsY = ry + 6;
  const boxW = 280;
  const boxX = margin + contentW - boxW;
  doc.roundedRect(boxX, totalsY, boxW, 70, 8).fill("#F9FAFB");
  doc.font("Helvetica").fontSize(10).fillColor("#6B7280");
  doc.text("Subtotal", boxX + PAD, totalsY + 10, { width: boxW - 100 - PAD });
  doc.text("Tax", boxX + PAD, totalsY + 26, { width: boxW - 100 - PAD });
  doc.text("Total", boxX + PAD, totalsY + 42, { width: boxW - 100 - PAD });
  doc.font("Helvetica-Bold").fillColor("#111827");
  doc.text(
    `${inv.currency} ${fmt(inv.subtotal)}`,
    boxX + boxW - 100,
    totalsY + 10,
    { width: 90, align: "right" }
  );
  doc.text(
    `${inv.currency} ${fmt(inv.taxTotal)}`,
    boxX + boxW - 100,
    totalsY + 26,
    { width: 90, align: "right" }
  );
  doc.fontSize(12).fillColor("#065F46");
  doc.text(
    `${inv.currency} ${fmt(inv.totalAmount)}`,
    boxX + boxW - 100,
    totalsY + 40,
    { width: 90, align: "right" }
  );
  doc.fillColor("#111827");

  if (inv.notes) {
    doc.font("Helvetica-Bold").fontSize(11).text("Notes", margin, totalsY);
    doc.font("Helvetica").fontSize(10).fillColor("#111827");
    doc.text(String(inv.notes), margin, totalsY + 16, {
      width: contentW - boxW - 20,
    });
  }
}

// Create invoice
router.post("/", auth, allowAdminOrHR, async (req, res) => {
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

    if (!["receivable", "payable"].includes(type))
      return res.status(400).json({ error: "Invalid type" });
    if (!["client", "employee", "vendor"].includes(partyType))
      return res.status(400).json({ error: "Invalid partyType" });
    if (!issueDate) return res.status(400).json({ error: "Missing issueDate" });

    // resolve partyName from employee or project when provided
    let resolvedPartyName = partyName;
    let resolvedPartyId = partyId;
    if (partyType === "employee" && partyId) {
      const emp = await Employee.findById(partyId).select("name email");
      if (emp) {
        resolvedPartyName = resolvedPartyName || emp.name;
      }
    }
    let resolvedProjectId = projectId;
    if (projectId) {
      const project = await Project.findById(projectId).select("title company");
      if (!project) return res.status(400).json({ error: "Invalid projectId" });
      if (String(project.company) !== String(req.employee.company))
        return res.status(403).json({ error: "Forbidden project" });
      // If project chosen and no party name, use project title as client name
      resolvedPartyName = resolvedPartyName || project.title;
      // If partyType omitted, default to client for project based invoices
      // (but we still require partyType in validation above; user passed it)
    }

    const { normalized, subtotal, taxTotal, totalAmount } =
      computeTotals(lineItems);
    if (!normalized.length)
      return res.status(400).json({ error: "Add at least one line item" });

    const { invoiceNumber, sequenceKey } = await nextInvoiceNumber(
      req.employee.company
    );

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
      currency: currency || "INR",
      lineItems: normalized,
      subtotal,
      taxTotal,
      totalAmount,
      notes,
      status: status || "draft",
    });
    res.json({ invoice: inv });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to create invoice" });
  }
});

// List invoices with filters
router.get("/", auth, allowAdminOrHR, async (req, res) => {
  try {
    const {
      type,
      status,
      partyType,
      invoiceNumber,
      q,
      from,
      to,
      dueFrom,
      dueTo,
      amountMin,
      amountMax,
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
        { invoiceNumber: { $regex: q, $options: "i" } },
        { partyName: { $regex: q, $options: "i" } },
      ];
    }
    if (from || to) {
      filter.issueDate = {};
      if (from) filter.issueDate.$gte = new Date(from);
      if (to) filter.issueDate.$lte = new Date(to);
    }
    if (dueFrom || dueTo) {
      filter.dueDate = filter.dueDate || {};
      if (dueFrom) filter.dueDate.$gte = new Date(dueFrom);
      if (dueTo) filter.dueDate.$lte = new Date(dueTo);
    }
    if (amountMin || amountMax) {
      filter.totalAmount = filter.totalAmount || {};
      if (amountMin) filter.totalAmount.$gte = Number(amountMin);
      if (amountMax) filter.totalAmount.$lte = Number(amountMax);
    }

    const sort = {};
    if (sortBy) {
      sort[sortBy] = String(sortDir || "").toLowerCase() === "asc" ? 1 : -1;
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
    res.status(500).json({ error: "Failed to list invoices" });
  }
});

// Get one
router.get("/:id", auth, allowAdminOrHR, async (req, res) => {
  const inv = await Invoice.findOne({
    _id: req.params.id,
    company: req.employee.company,
  }).populate("project", "title");
  if (!inv) return res.status(404).json({ error: "Not found" });
  res.json({ invoice: inv });
});

// Update invoice (including status)
router.put("/:id", auth, allowAdminOrHR, async (req, res) => {
  try {
    const allowed = [
      "partyType",
      "partyId",
      "partyName",
      "partyEmail",
      "partyAddress",
      "project",
      "issueDate",
      "dueDate",
      "paymentTerms",
      "currency",
      "lineItems",
      "notes",
      "status",
    ];
    const data = {};
    for (const k of allowed) if (k in req.body) data[k] = req.body[k];
    if (data.lineItems) {
      const { normalized, subtotal, taxTotal, totalAmount } = computeTotals(
        data.lineItems
      );
      if (!normalized.length)
        return res.status(400).json({ error: "Add at least one line item" });
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
    if (!inv) return res.status(404).json({ error: "Not found" });
    res.json({ invoice: inv });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to update invoice" });
  }
});

// Delete invoice
router.delete("/:id", auth, allowAdminOrHR, async (req, res) => {
  const inv = await Invoice.findOneAndDelete({
    _id: req.params.id,
    company: req.employee.company,
  });
  if (!inv) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});

// Upload attachments (for payable or general docs)
router.post(
  "/:id/attachments",
  auth,
  allowAdminOrHR,
  upload.array("files"),
  async (req, res) => {
    try {
      const files = (req.files || []).map((f) => f.filename);
      const inv = await Invoice.findOneAndUpdate(
        { _id: req.params.id, company: req.employee.company },
        { $push: { attachments: { $each: files } } },
        { new: true }
      );
      if (!inv) return res.status(404).json({ error: "Not found" });
      res.json({ invoice: inv });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to upload attachments" });
    }
  }
);

// Upload client (party) logo for this invoice
router.post(
  "/:id/party-logo",
  auth,
  allowAdminOrHR,
  upload.single("logo"),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file" });
      const inv = await Invoice.findOneAndUpdate(
        { _id: req.params.id, company: req.employee.company },
        { $set: { partyLogo: req.file.filename } },
        { new: true }
      );
      if (!inv) return res.status(404).json({ error: "Not found" });
      res.json({ invoice: inv });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to upload logo" });
    }
  }
);

// Generate PDF (on the fly) and stream using drawInvoice
router.get("/:id/pdf", auth, allowAdminOrHR, async (req, res) => {
  const inv = await Invoice.findOne({
    _id: req.params.id,
    company: req.employee.company,
  })
    .populate("company")
    .populate("project", "title")
    .lean();
  if (!inv) return res.status(404).json({ error: "Not found" });

  const filename = `Invoice-${safeName(inv.invoiceNumber)}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 36, bottom: 40, left: 36, right: 36 },
  });
  doc.pipe(res);
  drawInvoice(doc, inv);
  doc.end();
});

// Email PDF
router.post("/:id/email", auth, allowAdminOrHR, async (req, res) => {
  try {
    const inv = await Invoice.findOne({
      _id: req.params.id,
      company: req.employee.company,
    })
      .populate("company")
      .populate("project", "title");
    if (!inv) return res.status(404).json({ error: "Not found" });
    const to = req.body?.to || inv.partyEmail;
    if (!to) return res.status(400).json({ error: "Missing recipient email" });

    // Render PDF to buffer using drawInvoice
    const pdfChunks = [];
    const pdfDoc = new PDFDocument({
      size: "A4",
      margins: { top: 36, bottom: 40, left: 36, right: 36 },
    });
    pdfDoc.on("data", (c) => pdfChunks.push(c));
    const pdfDone = new Promise((resolve) => pdfDoc.on("end", resolve));
    drawInvoice(pdfDoc, inv);
    pdfDoc.end();
    await pdfDone;
    const pdfBuffer = Buffer.concat(pdfChunks);

    // Build HTML invoice with logo (CID)
    const logoFile =
      inv.company?.logoHorizontal ||
      inv.company?.logo ||
      inv.company?.logoSquare;
    const clientLogoFile = inv.partyLogo
      ? path.join(__dirname, "../../uploads", String(inv.partyLogo))
      : null;
    const attachments = [
      { filename: `${inv.invoiceNumber}.pdf`, content: pdfBuffer },
    ];
    if (logoFile) {
      const logoPath = path.join(__dirname, "../../uploads", String(logoFile));
      if (fs.existsSync(logoPath))
        attachments.push({
          filename: "logo.png",
          path: logoPath,
          cid: "brandlogo",
        });
    }
    if (clientLogoFile && fs.existsSync(clientLogoFile)) {
      attachments.push({
        filename: "clientlogo.png",
        path: clientLogoFile,
        cid: "clientlogo",
      });
    }
    const fmt = (n) =>
      Number(n || 0).toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    const html = `
      <div style="font-family: -apple-system, Segoe UI, Roboto, Arial; color:#111827;">
        <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 0; border-bottom:1px solid #e5e7eb;">
          <div>${
            logoFile
              ? '<img src="cid:brandlogo" alt="logo" style="max-height:40px;" />'
              : ""
          }</div>
          <div style="text-align:right;">
            <div style="font-weight:600; font-size:18px;">${
              inv.company?.name || "Company"
            }</div>
            <div style="color:#6b7280; font-size:12px;">Invoice # ${
              inv.invoiceNumber
            }</div>
          </div>
        </div>
        <div style="display:flex; justify-content:space-between; padding:12px 0;">
          <div>
            <div style="font-weight:600;">Bill To</div>
            ${
              clientLogoFile
                ? '<div><img src="cid:clientlogo" alt="client logo" style="max-height:28px; margin:4px 0;" /></div>'
                : ""
            }
            <div>${inv.partyName || "-"}</div>
            ${
              inv.partyEmail
                ? `<div style="color:#6b7280; font-size:12px;">${inv.partyEmail}</div>`
                : ""
            }
            ${
              inv.partyAddress
                ? `<div style="white-space:pre-wrap; color:#6b7280; font-size:12px;">${inv.partyAddress}</div>`
                : ""
            }
          </div>
          <div style="text-align:right; color:#374151; font-size:12px;">
            <div>Issue: ${new Date(inv.issueDate).toLocaleDateString(
              "en-GB"
            )}</div>
            ${
              inv.dueDate
                ? `<div>Due: ${new Date(inv.dueDate).toLocaleDateString(
                    "en-GB"
                  )}</div>`
                : ""
            }
            ${
              inv.project
                ? `<div>Project: ${inv.project.title || inv.project}</div>`
                : ""
            }
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
            ${(inv.lineItems || [])
              .map(
                (li) => `
              <tr>
                <td style=\"padding:8px; border:1px solid #e5e7eb;\">${
                  li.description || ""
                }</td>
                <td style=\"padding:8px; border:1px solid #e5e7eb; text-align:right;\">${Number(
                  li.quantity || 0
                )}</td>
                <td style=\"padding:8px; border:1px solid #e5e7eb; text-align:right;\">${
                  inv.currency
                } ${fmt(li.rate)}</td>
                <td style=\"padding:8px; border:1px solid #e5e7eb; text-align:right;\">${Number(
                  li.taxPercent || 0
                )}</td>
                <td style=\"padding:8px; border:1px solid #e5e7eb; text-align:right;\">${
                  inv.currency
                } ${fmt(li.total)}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
        <div style="display:flex; justify-content:flex-end; padding-top:10px;">
          <table style="min-width:280px; border-collapse:collapse;">
            <tr>
              <td style="padding:6px; color:#6b7280;">Subtotal</td>
              <td style="padding:6px; text-align:right;">${inv.currency} ${fmt(
      inv.subtotal
    )}</td>
            </tr>
            <tr>
              <td style="padding:6px; color:#6b7280;">Tax</td>
              <td style="padding:6px; text-align:right;">${inv.currency} ${fmt(
      inv.taxTotal
    )}</td>
            </tr>
            <tr>
              <td style="padding:6px; font-weight:600;">Total</td>
              <td style="padding:6px; text-align:right; font-weight:700; color:#065F46;">${
                inv.currency
              } ${fmt(inv.totalAmount)}</td>
            </tr>
          </table>
        </div>
        ${
          inv.notes
            ? `<div style=\"margin-top:12px;\"><div style=\"font-weight:600;\">Notes</div><div style=\"color:#374151;\">${String(
                inv.notes
              )}</div></div>`
            : ""
        }
        <div style="margin-top:16px; color:#9ca3af; font-size:12px; text-align:center;">This invoice was generated by HRMS</div>
      </div>`;

    const subject = `${inv.company?.name || "Company"} Invoice ${
      inv.invoiceNumber
    }`;
    if (!isEmailEnabled())
      return res
        .status(200)
        .json({ skipped: true, message: "Email not configured" });
    await sendMail({ to, subject, html, attachments });
    if (inv.status === "draft") {
      inv.status = "sent";
      await inv.save();
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to email invoice" });
  }
});

// Export report (Excel)
router.get("/reports/export", auth, allowAdminOrHR, async (req, res) => {
  try {
    const {
      from,
      to,
      type,
      status,
      q,
      partyType,
      dueFrom,
      dueTo,
      amountMin,
      amountMax,
    } = req.query || {};
    const filter = { company: req.employee.company };
    if (type) filter.type = type;
    if (status) filter.status = status;
    if (partyType) filter.partyType = partyType;
    if (q) {
      filter.$or = [
        { invoiceNumber: { $regex: q, $options: "i" } },
        { partyName: { $regex: q, $options: "i" } },
      ];
    }
    if (from || to) {
      filter.issueDate = {};
      if (from) filter.issueDate.$gte = new Date(from);
      if (to) filter.issueDate.$lte = new Date(to);
    }
    if (dueFrom || dueTo) {
      filter.dueDate = {};
      if (dueFrom) filter.dueDate.$gte = new Date(dueFrom);
      if (dueTo) filter.dueDate.$lte = new Date(dueTo);
    }
    if (amountMin || amountMax) {
      filter.totalAmount = {};
      if (amountMin) filter.totalAmount.$gte = Number(amountMin);
      if (amountMax) filter.totalAmount.$lte = Number(amountMax);
    }
    const items = await Invoice.find(filter).sort({ issueDate: 1 }).lean();

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Invoices");
    ws.columns = [
      { header: "Invoice #", key: "invoiceNumber", width: 20 },
      { header: "Type", key: "type", width: 12 },
      { header: "Status", key: "status", width: 12 },
      { header: "Issue Date", key: "issueDate", width: 18 },
      { header: "Due Date", key: "dueDate", width: 18 },
      { header: "Party", key: "party", width: 28 },
      { header: "Amount", key: "amount", width: 14 },
    ];
    items.forEach((it) => {
      ws.addRow({
        invoiceNumber: it.invoiceNumber,
        type: it.type,
        status: it.status,
        issueDate: it.issueDate
          ? new Date(it.issueDate).toISOString().slice(0, 10)
          : "",
        dueDate: it.dueDate
          ? new Date(it.dueDate).toISOString().slice(0, 10)
          : "",
        party: it.partyName || "",
        amount: it.totalAmount,
      });
    });

    // Summary sheet with Receivable/Payable and Cash Flow
    const ws2 = wb.addWorksheet("Summary");
    const sumBy = (arr, pred) =>
      arr.reduce(
        (s, it) => s + (pred(it) ? Number(it.totalAmount || 0) : 0),
        0
      );
    const recv = items.filter((it) => it.type === "receivable");
    const pay = items.filter((it) => it.type === "payable");
    const recvTotal = sumBy(recv, () => true);
    const recvPaid = sumBy(recv, (it) => it.status === "paid");
    const recvOverdue = sumBy(recv, (it) => it.status === "overdue");
    const recvPending = sumBy(recv, (it) =>
      ["pending", "sent", "draft"].includes(it.status)
    );
    const payTotal = sumBy(pay, () => true);
    const payPaid = sumBy(pay, (it) => it.status === "paid");
    const payOverdue = sumBy(pay, (it) => it.status === "overdue");
    const payPending = sumBy(pay, (it) =>
      ["pending", "sent", "draft"].includes(it.status)
    );
    ws2.addRow(["Receivable Summary"]);
    ws2.addRow(["Total Raised", recvTotal]);
    ws2.addRow(["Paid Amount", recvPaid]);
    ws2.addRow(["Pending Receivable", recvPending]);
    ws2.addRow(["Overdue Amount", recvOverdue]);
    ws2.addRow([]);
    ws2.addRow(["Payable Summary"]);
    ws2.addRow(["Total Bills Received", payTotal]);
    ws2.addRow(["Paid Amount", payPaid]);
    ws2.addRow(["Pending Payable", payPending]);
    ws2.addRow(["Overdue Bills", payOverdue]);
    ws2.addRow([]);
    ws2.addRow(["Cash Flow Snapshot"]);
    ws2.addRow(["Incoming (Receivable)", recvTotal]);
    ws2.addRow(["Outgoing (Payable)", payTotal]);
    ws2.addRow(["Net Balance", recvTotal - payTotal]);

    // Party-wise summary (Client/Vendor)
    const ws3 = wb.addWorksheet(type === "payable" ? "By Vendor" : "By Client");
    ws3.columns = [
      {
        header: type === "payable" ? "Vendor" : "Client",
        key: "name",
        width: 30,
      },
      { header: "Invoices", key: "count", width: 10 },
      { header: "Total Amount", key: "amount", width: 16 },
      { header: "Paid", key: "paid", width: 14 },
      { header: "Pending/Sent", key: "pending", width: 16 },
      { header: "Overdue", key: "overdue", width: 14 },
    ];
    const byClient = items.reduce((m, it) => {
      const key = it.partyName || "-";
      if (!m[key])
        m[key] = {
          name: key,
          count: 0,
          amount: 0,
          paid: 0,
          pending: 0,
          overdue: 0,
        };
      const amt = Number(it.totalAmount || 0);
      m[key].count += 1;
      m[key].amount += amt;
      if (it.status === "paid") m[key].paid += amt;
      else if (it.status === "overdue") m[key].overdue += amt;
      else m[key].pending += amt; // includes draft/sent/pending
      return m;
    }, {});
    Object.values(byClient).forEach((row) => ws3.addRow(row));

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="invoices.xlsx"'
    );
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to export report" });
  }
});

// Export report (PDF)
router.get("/reports/export-pdf", auth, allowAdminOrHR, async (req, res) => {
  try {
    const {
      from,
      to,
      type,
      status,
      q,
      partyType,
      dueFrom,
      dueTo,
      amountMin,
      amountMax,
    } = req.query || {};

    // ---------------- Filters
    const base = { company: req.employee.company };
    if (status) base.status = status;
    if (partyType) base.partyType = partyType;
    if (q) {
      base.$or = [
        { invoiceNumber: { $regex: q, $options: "i" } },
        { partyName: { $regex: q, $options: "i" } },
      ];
    }
    if (from || to) {
      base.issueDate = {};
      if (from) base.issueDate.$gte = new Date(String(from));
      if (to) base.issueDate.$lte = new Date(String(to));
    }
    if (dueFrom || dueTo) {
      base.dueDate = {};
      if (dueFrom) base.dueDate.$gte = new Date(String(dueFrom));
      if (dueTo) base.dueDate.$lte = new Date(String(dueTo));
    }
    if (amountMin || amountMax) {
      base.totalAmount = {};
      if (amountMin) base.totalAmount.$gte = Number(amountMin);
      if (amountMax) base.totalAmount.$lte = Number(amountMax);
    }

    // ---------------- Data
    const filterForItems = { ...base, ...(type ? { type } : {}) };
    const items = await Invoice.find(filterForItems)
      .sort({ issueDate: 1 })
      .lean();

    const [recvAll, payAll] = await Promise.all([
      Invoice.find({ ...base, type: "receivable" }).lean(),
      Invoice.find({ ...base, type: "payable" }).lean(),
    ]);

    // currency detect (fallback INR)
    const detectCurrency = () =>
      items.find((it) => it?.currency)?.currency ||
      recvAll.find((it) => it?.currency)?.currency ||
      payAll.find((it) => it?.currency)?.currency ||
      "INR";

    const currency = detectCurrency();
    const nf = new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
      style: "currency",
      currency,
      currencyDisplay: currency === "INR" ? "code" : "symbol", // avoid ₹ glyph issues
      maximumFractionDigits: 2,
    });
    const money = (n) => nf.format(Number(n || 0));

    const sumBy = (arr, pred) =>
      arr.reduce(
        (s, it) => s + (pred(it) ? Number(it.totalAmount || 0) : 0),
        0
      );

    const recvTotal = sumBy(recvAll, () => true);
    const recvPaid = sumBy(recvAll, (it) => it.status === "paid");
    const recvOverdue = sumBy(recvAll, (it) => it.status === "overdue");
    const recvPending = sumBy(recvAll, (it) =>
      ["pending", "sent", "draft"].includes(it.status)
    );

    const payTotal = sumBy(payAll, () => true);
    const payPaid = sumBy(payAll, (it) => it.status === "paid");
    const payOverdue = sumBy(payAll, (it) => it.status === "overdue");
    const payPending = sumBy(payAll, (it) =>
      ["pending", "sent", "draft"].includes(it.status)
    );

    // by party (current type items)
    const byParty = Object.entries(
      items.reduce((m, it) => {
        const key = it.partyName || "-";
        const amt = Number(it.totalAmount || 0);
        if (!m[key])
          m[key] = {
            name: key,
            amount: 0,
            paid: 0,
            pending: 0,
            overdue: 0,
          };
        m[key].amount += amt;
        if (it.status === "paid") m[key].paid += amt;
        else if (it.status === "overdue") m[key].overdue += amt;
        else m[key].pending += amt;
        return m;
      }, {})
    )
      .map(([, v]) => v)
      .sort((a, b) => b.amount - a.amount);

    // ---------------- PDF headers
    res.setHeader("Content-Type", "application/pdf");
    const fname = `invoices-report${type ? "-" + type : ""}${
      from || to ? "-" + (from || "") + "_" + (to || "") : ""
    }.pdf`;
    res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);

    // ---------------- PDF (single page, grayscale)
    const doc = new PDFDocument({
      size: "A4",
      margin: 36,
      autoFirstPage: true,
    });
    doc.pipe(res);

    const COLOR = {
      text: "#111827", // near black
      sub: "#6B7280", // gray
      line: "#D1D5DB", // light gray
      headerBg: "#F3F4F6", // very light gray
    };

    const PAGE_W = doc.page.width;
    const PAGE_H = doc.page.height;
    const M = 36;
    const CONTENT_WIDTH = PAGE_W - 2 * M;
    const FOOTER_H = 18;

    // ---------- helpers
    function drawRule() {
      const y = Math.round(doc.y);
      doc
        .strokeColor(COLOR.line)
        .moveTo(M, y)
        .lineTo(PAGE_W - M, y)
        .stroke();
      doc.moveDown(0.6);
    }

    function printKV(doc, x, y, key, value, colWidth) {
      const PAD = 2;
      const labelW = Math.floor(colWidth * 0.48);
      const valueW = colWidth - labelW;
      doc.fillColor(COLOR.sub).text(String(key), Math.round(x), Math.round(y), {
        width: labelW - PAD,
        align: "left",
        lineBreak: false,
        continued: false,
      });
      doc
        .fillColor(COLOR.text)
        .text(String(value), Math.round(x + labelW), Math.round(y), {
          width: valueW - PAD,
          align: "right",
          lineBreak: false,
          continued: false,
        });
      return y + 13; // fixed row height
    }

    function truncToWidth(text, px) {
      const ell = "…";
      if (!text) return "";
      if (doc.widthOfString(text) <= px) return text;
      let s = text;
      while (s && doc.widthOfString(s + ell) > px) s = s.slice(0, -1);
      return s + ell;
    }

    // ---------- header
    // Load company for logo/name
    let company = null;
    try {
      company = await Company.findById(req.employee.company).lean();
    } catch (_) {}
    const companyName =
      company?.name || req.employee?.company?.name || "Company";

    // Brand logo (top-right)
    let logoSpace = 0;
    try {
      const logoFile =
        company?.logoHorizontal || company?.logo || company?.logoSquare;
      if (logoFile) {
        const logoPath = path.join(
          __dirname,
          "../../uploads",
          String(logoFile)
        );
        if (fs.existsSync(logoPath)) {
          const LOGO_MAX_W = 140;
          const LOGO_MAX_H = 36;
          const logoX = PAGE_W - M - LOGO_MAX_W;
          const logoY = M - 4; // slightly above text baseline
          doc.image(logoPath, logoX, logoY, {
            fit: [LOGO_MAX_W, LOGO_MAX_H],
            align: "right",
          });
          logoSpace = LOGO_MAX_W + 8; // reserve space to avoid overlap
        }
      }
    } catch (_) {}

    const period =
      from || to
        ? `Issue: ${from || "…"} → ${to || "…"}`
        : dueFrom || dueTo
        ? `Due: ${dueFrom || "…"} → ${dueTo || "…"}`
        : "";

    const headerTextWidth = CONTENT_WIDTH - logoSpace;

    doc
      .fillColor(COLOR.text)
      .font("Helvetica-Bold")
      .fontSize(14)
      .text("Invoice Report", M, undefined, { width: headerTextWidth, ellipsis: true });
    doc.moveDown(0.15);
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor(COLOR.sub)
      .text(`${companyName}${period ? " • " + period : ""}`, {
        width: headerTextWidth,
        ellipsis: true,
      });

    const filtersLine = [
      type ? `Type: ${type}` : null,
      status ? `Status: ${status}` : null,
      partyType ? `Party: ${partyType}` : null,
      q ? `Search: ${q}` : null,
      amountMin || amountMax
        ? `Amount: ${amountMin || "0"} – ${amountMax || "∞"}`
        : null,
    ]
      .filter(Boolean)
      .join("  |  ");

    if (filtersLine) {
      doc.moveDown(0.15);
      doc
        .fillColor(COLOR.sub)
        .text(filtersLine, { width: headerTextWidth, ellipsis: true });
    }
    doc.moveDown(0.5);
    drawRule();

    // ---------- summary (two fixed columns + gutter)
    const GUTTER = 32;
    const y0 = Math.round(doc.y);
    const colW = Math.floor((CONTENT_WIDTH - GUTTER) / 2);
    const x1 = M;
    const x2 = M + colW + GUTTER;

    doc
      .fillColor(COLOR.text)
      .font("Helvetica-Bold")
      .fontSize(11)
      .text("Receivable", x1, y0);
    doc.font("Helvetica").fontSize(10);
    let yL = y0 + 14;
    yL = printKV(doc, x1, yL, "Total", money(recvTotal), colW);
    yL = printKV(doc, x1, yL, "Paid", money(recvPaid), colW);
    yL = printKV(doc, x1, yL, "Pending", money(recvPending), colW);
    yL = printKV(doc, x1, yL, "Overdue", money(recvOverdue), colW);

    doc
      .fillColor(COLOR.text)
      .font("Helvetica-Bold")
      .fontSize(11)
      .text("Payable", x2, y0);
    doc.font("Helvetica").fontSize(10);
    let yR = y0 + 14;
    yR = printKV(doc, x2, yR, "Total", money(payTotal), colW);
    yR = printKV(doc, x2, yR, "Paid", money(payPaid), colW);
    yR = printKV(doc, x2, yR, "Pending", money(payPending), colW);
    yR = printKV(doc, x2, yR, "Overdue", money(payOverdue), colW);

    const afterSummaryY = Math.max(yL, yR) + 8;

    // ---------- cashflow line
    doc
      .strokeColor(COLOR.line)
      .moveTo(M, Math.round(afterSummaryY))
      .lineTo(PAGE_W - M, Math.round(afterSummaryY))
      .stroke();
    doc.moveDown(0.4);

    const incoming = recvTotal,
      outgoing = payTotal,
      net = incoming - outgoing;
    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor(COLOR.text)
      .text(
        `Incoming: ${money(incoming)}    Outgoing: ${money(
          outgoing
        )}    Net: ${money(net)}`,
        M,
        Math.round(afterSummaryY + 6),
        { width: CONTENT_WIDTH, ellipsis: true }
      );

    doc.moveDown(0.8);
    drawRule();

    // ---------- table: By Party (single page, exact fit)
    const title = type === "payable" ? "By Vendor" : "By Client";
    doc.font("Helvetica-Bold").fontSize(11).fillColor(COLOR.text).text(title);
    doc.moveDown(0.2);

    const AVAIL_W = CONTENT_WIDTH; // exact printable width
    const COL_DEF = [
      { key: "name", header: "Party", pct: 0.36, align: "left" },
      {
        key: "amount",
        header: "Total",
        pct: 0.16,
        align: "right",
        map: (v) => money(v),
      },
      {
        key: "paid",
        header: "Paid",
        pct: 0.16,
        align: "right",
        map: (v) => money(v),
      },
      {
        key: "pending",
        header: "Pending",
        pct: 0.14,
        align: "right",
        map: (v) => money(v),
      },
      {
        key: "overdue",
        header: "Overdue",
        pct: 0.1,
        align: "right",
        map: (v) => money(v),
      },
    ];
    const widths = COL_DEF.map((c) => Math.floor(c.pct * AVAIL_W));
    const drift = AVAIL_W - widths.reduce((a, b) => a + b, 0);
    widths[widths.length - 1] += drift; // absorb rounding drift
    const cols = COL_DEF.map((c, i) => ({ ...c, width: widths[i] }));

    const headerH = 18,
      rowH = 16;
    let ty = Math.round(doc.y);
    const tableW = cols.reduce((s, c) => s + c.width, 0); // == AVAIL_W

    // header band
    doc.rect(M, ty, tableW, headerH).fill(COLOR.headerBg);
    doc.fillColor(COLOR.text).font("Helvetica-Bold").fontSize(9);
    let tx = M;
    cols.forEach((c) => {
      doc.text(c.header, Math.round(tx) + 6, ty + 4, {
        width: c.width - 12,
        align: c.align,
        lineBreak: false,
        continued: false,
      });
      tx += c.width;
    });
    ty += headerH;
    doc
      .strokeColor(COLOR.line)
      .moveTo(M, ty)
      .lineTo(M + tableW, ty)
      .stroke();

    // rows (fit single page)
    const available = PAGE_H - M - FOOTER_H - ty - 6;
    const maxRows = Math.max(0, Math.floor(available / rowH));
    const rows = byParty;
    const shown = rows.slice(0, maxRows);

    doc.font("Helvetica").fontSize(9).fillColor(COLOR.text);
    shown.forEach((r) => {
      let x = M;
      cols.forEach((c) => {
        let val = c.map ? c.map(r[c.key]) : String(r[c.key] ?? "");
        if (c.key === "name") val = truncToWidth(val, c.width - 12); // single line
        doc.text(val, Math.round(x) + 6, ty + 3, {
          width: c.width - 12,
          align: c.align,
          lineBreak: false,
          continued: false,
        });
        x += c.width;
      });
      ty += rowH;
      doc
        .strokeColor(COLOR.line)
        .moveTo(M, ty)
        .lineTo(M + tableW, ty)
        .stroke();
    });

    if (rows.length > shown.length) {
      doc
        .fillColor(COLOR.sub)
        .font("Helvetica-Oblique")
        .text(`… and ${rows.length - shown.length} more`, M, ty + 4, {
          width: tableW,
          align: "left",
          lineBreak: false,
        });
    }

    // ---------- footer
    const footerY = PAGE_H - M + 2;
    doc
      .strokeColor(COLOR.line)
      .moveTo(M, footerY - 8)
      .lineTo(PAGE_W - M, footerY - 8)
      .stroke();
    doc.fillColor(COLOR.sub).font("Helvetica").fontSize(9);
    doc.text(`Generated ${new Date().toLocaleString()}`, M, footerY, {
      width: CONTENT_WIDTH / 2,
      align: "left",
    });
    doc.text("Page 1", M + CONTENT_WIDTH / 2, footerY, {
      width: CONTENT_WIDTH / 2,
      align: "right",
    });

    doc.end();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to export report PDF" });
  }
});

// -------- small helpers
function drawRule(doc, color) {
  const w = doc.page.width,
    M = 36;
  doc
    .moveTo(M, doc.y)
    .lineTo(w - M, doc.y)
    .strokeColor(color)
    .stroke();
  doc.moveDown(0.6);
}
function printKV(doc, x, y, k, v, colWidth) {
  const labelW = Math.floor(colWidth * 0.48);
  const valW = colWidth - labelW;
  doc
    .fillColor("#6B7280")
    .text(String(k), x, y, { width: labelW, lineBreak: false });
  doc.fillColor("#111827").text(String(v), x + labelW, y, {
    width: valW,
    align: "right",
    lineBreak: false,
  });
  return y + 13;
}

module.exports = router;
