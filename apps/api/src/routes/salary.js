const router = require("express").Router();
const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");
const { auth } = require("../middleware/auth");
const { requirePrimary, requireAnySub } = require("../middleware/roles");
const Company = require("../models/Company");
const Employee = require("../models/Employee");
const SalaryTemplate = require("../models/SalaryTemplate");
const SalarySlip = require("../models/SalarySlip");
const PDFDocument = require("pdfkit");
const Attendance = require("../models/Attendance");
const Leave = require("../models/Leave");

function monthValid(m) {
  return typeof m === "string" && /^\d{4}-\d{2}$/.test(m);
}

// Default locked keys and helpers
const BASIC_KEY = "basic_earned";
const HRA_KEY = "hra";
const MEDICAL_KEY = "medical";
const OTHER_KEY = "other_allowances";

function defaultLockedFields() {
  return [
    {
      key: BASIC_KEY,
      label: "Basic Earned",
      type: "number",
      required: true,
      locked: true,
      category: "earning",
      order: 0,
    },
    {
      key: HRA_KEY,
      label: "HRA",
      type: "number",
      required: true,
      locked: true,
      category: "earning",
      order: 1,
    },
    {
      key: MEDICAL_KEY,
      label: "Medical",
      type: "number",
      required: false,
      locked: true,
      category: "earning",
      order: 2,
    },
    {
      key: OTHER_KEY,
      label: "Other Allowances",
      type: "number",
      required: false,
      locked: true,
      category: "earning",
      order: 3,
    },
  ];
}

function withDefaultSettings(settings) {
  const s = settings || {};
  return {
    basicPercent: Number.isFinite(Number(s.basicPercent))
      ? Number(s.basicPercent)
      : 30,
    hraPercent: Number.isFinite(Number(s.hraPercent))
      ? Number(s.hraPercent)
      : 45,
    medicalAmount: Number.isFinite(Number(s.medicalAmount))
      ? Number(s.medicalAmount)
      : 1500,
  };
}

function ensureTemplateDefaults(tplIn) {
  const tpl = tplIn ? { ...tplIn } : { fields: [] };
  const fields = Array.isArray(tpl.fields) ? [...tpl.fields] : [];
  const existingKeys = new Set(fields.map((f) => f.key));
  const locked = defaultLockedFields();
  const toAdd = locked.filter((f) => !existingKeys.has(f.key));
  const merged = [
    ...locked.map((lf) => ({ ...lf })),
    ...fields.filter((f) => !locked.some((lf) => lf.key === f.key)),
  ];
  return {
    ...tpl,
    fields: merged,
    settings: withDefaultSettings(tpl.settings),
  };
}

// Get salary template for current company
router.get("/templates", auth, async (req, res) => {
  try {
    const companyId = req.employee.company;
    if (!companyId) return res.status(400).json({ error: "Company not found" });
    let tpl = await SalaryTemplate.findOne({ company: companyId }).lean();
    if (!tpl)
      tpl = { company: companyId, fields: [], settings: withDefaultSettings() };
    res.json({ template: ensureTemplateDefaults(tpl) });
  } catch (e) {
    res.status(500).json({ error: "Failed to load template" });
  }
});

// Create/update salary template (Admin only)
router.post(
  "/templates",
  auth,
  requirePrimary(["ADMIN", "SUPERADMIN"]),
  async (req, res) => {
    try {
      const { fields, settings } = req.body || {};
      if (!Array.isArray(fields))
        return res.status(400).json({ error: "Invalid fields" });
      const company = await Company.findOne({ admin: req.employee.id });
      const companyId = company ? company._id : req.employee.company;
      if (!companyId)
        return res.status(400).json({ error: "Company not found" });

      const sanitized = fields
        .map((f, idx) => ({
          key:
            String(f.key || "").trim() ||
            String(f.label || "")
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "_")
              .replace(/^_|_$/g, ""),
          label: String(f.label || "").trim(),
          type: ["text", "number", "date"].includes(f.type) ? f.type : "text",
          required: !!f.required,
          locked: !!f.locked, // client-provided locked ignored for default keys; kept for any future server-defined fields
          category: ["earning", "deduction", "info"].includes(f.category)
            ? f.category
            : "info",
          defaultValue: f.defaultValue,
          order: typeof f.order === "number" ? f.order : idx,
        }))
        .filter((f) => f.label && f.key);

      // Deduplicate keys
      const seen = new Set();
      for (const f of sanitized) {
        if (seen.has(f.key))
          return res.status(400).json({ error: `Duplicate key: ${f.key}` });
        seen.add(f.key);
      }

      // Enforce locked defaults and merge
      const locked = defaultLockedFields();
      const custom = sanitized.filter(
        (f) => !locked.some((lf) => lf.key === f.key)
      );
      const mergedFields = [...locked, ...custom].map((f, i) => ({
        ...f,
        order: i,
      }));

      const tpl = await SalaryTemplate.findOneAndUpdate(
        { company: companyId },
        {
          company: companyId,
          fields: mergedFields,
          settings: withDefaultSettings(settings),
          updatedBy: req.employee.id,
        },
        { upsert: true, new: true }
      );

      res.json({ template: ensureTemplateDefaults(tpl.toObject()) });
    } catch (e) {
      res.status(500).json({ error: "Failed to save template" });
    }
  }
);

// Helper to authorize managers/hr/admin to manage slips for others
async function canManageFor(req, employeeId) {
  if (!employeeId) return false;
  const me = req.employee;
  if (!me) return false;
  // self is always OK for view
  if (String(me.id) === String(employeeId)) return true;
  if (["ADMIN", "SUPERADMIN"].includes(me.primaryRole)) return true;
  const subs = me.subRoles || [];
  if (subs.includes("hr")) return true; // managers should not manage salary slips
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
  return {
    [BASIC_KEY]: basic,
    [HRA_KEY]: hra,
    [MEDICAL_KEY]: medical,
    [OTHER_KEY]: other,
  };
}

function overlayLocked(values, lockedVals) {
  const out = { ...(values || {}) };
  for (const k of [BASIC_KEY, HRA_KEY, MEDICAL_KEY, OTHER_KEY])
    out[k] = lockedVals[k];
  return out;
}

// Overlay template defaults for non-locked fields where value is missing
function overlayDefaults(template, values) {
  const out = { ...(values || {}) };
  const fields = template?.fields || [];
  for (const f of fields) {
    if (f && !f.locked) {
      const hasVal =
        out[f.key] !== undefined && out[f.key] !== null && out[f.key] !== "";
      const hasDefault =
        f.defaultValue !== undefined &&
        f.defaultValue !== null &&
        f.defaultValue !== "";
      if (!hasVal && hasDefault) {
        out[f.key] =
          f.type === "number" ? numberOrZero(f.defaultValue) : f.defaultValue;
      }
    }
  }
  return out;
}

// Get salary slip for an employee + month (self or hr/manager/admin)
router.get("/slips", auth, async (req, res) => {
  try {
    let { employeeId, month } = req.query;
    if (!monthValid(month))
      return res.status(400).json({ error: "Invalid month" });
    if (!employeeId) employeeId = req.employee.id;
    if (!(await canManageFor(req, employeeId)))
      return res.status(403).json({ error: "Forbidden" });

    // ensure employee is in same company
    const employee = await Employee.findById(employeeId).select("company ctc");
    if (!employee) return res.status(404).json({ error: "Employee not found" });
    const companyId = req.employee.company || employee.company;
    if (!companyId || !employee.company.equals(companyId))
      return res.status(403).json({ error: "Forbidden" });

    const [tpl, slip] = await Promise.all([
      SalaryTemplate.findOne({ company: companyId }).lean(),
      SalarySlip.findOne({
        employee: employeeId,
        company: companyId,
        month,
      }).lean(),
    ]);

    const template = ensureTemplateDefaults(
      tpl || { company: companyId, fields: [] }
    );
    const rawVals = slip?.values || {};
    const lockedVals = computeLockedValues({ template, employee });
    const values = overlayDefaults(
      template,
      overlayLocked(
        rawVals instanceof Map ? Object.fromEntries(rawVals) : rawVals,
        lockedVals
      )
    );

    res.json({
      template,
      slip: slip
        ? { ...slip, values }
        : { employee: employeeId, company: companyId, month, values },
    });
  } catch (e) {
    res.status(500).json({ error: "Failed to load slip" });
  }
});

// Shortcut for self
router.get("/slips/mine", auth, async (req, res) => {
  try {
    const { month } = req.query;
    if (!monthValid(month))
      return res.status(400).json({ error: "Invalid month" });
    const employeeId = req.employee.id;
    const companyId = req.employee.company;
    if (!companyId) return res.status(400).json({ error: "Company not found" });
    const [employee, tpl, slip] = await Promise.all([
      Employee.findById(employeeId).select("ctc"),
      SalaryTemplate.findOne({ company: companyId }).lean(),
      SalarySlip.findOne({
        employee: employeeId,
        company: companyId,
        month,
      }).lean(),
    ]);
    const template = ensureTemplateDefaults(
      tpl || { company: companyId, fields: [] }
    );
    const rawVals = slip?.values || {};
    const lockedVals = computeLockedValues({ template, employee });
    const values = overlayDefaults(
      template,
      overlayLocked(
        rawVals instanceof Map ? Object.fromEntries(rawVals) : rawVals,
        lockedVals
      )
    );
    res.json({
      template,
      slip: slip
        ? { ...slip, values }
        : { employee: employeeId, company: companyId, month, values },
    });
  } catch (e) {
    res.status(500).json({ error: "Failed to load slip" });
  }
});

// Create/update salary slip (admin/hr/manager)
router.post("/slips", auth, async (req, res) => {
  try {
    const { employeeId, month, values } = req.body || {};
    if (!employeeId || !monthValid(month) || typeof values !== "object")
      return res.status(400).json({ error: "Invalid payload" });

    const me = req.employee;
    const allowed =
      ["ADMIN", "SUPERADMIN"].includes(me.primaryRole) ||
      (me.subRoles || []).some((r) => ["hr"].includes(r));
    if (!allowed) return res.status(403).json({ error: "Forbidden" });

    const employee = await Employee.findById(employeeId).select("company");
    if (!employee) return res.status(404).json({ error: "Employee not found" });
    const companyId = me.company || employee.company;
    if (!companyId || !employee.company.equals(companyId))
      return res.status(403).json({ error: "Forbidden" });

    const tpl = await SalaryTemplate.findOne({ company: companyId }).lean();
    const template = ensureTemplateDefaults(tpl || {});
    // Only allow non-locked fields to be set by user
    const nonLockedFields = (template?.fields || []).filter((f) => !f.locked);
    const allowedKeys = new Set(nonLockedFields.map((f) => f.key));
    const typeByKey = new Map(nonLockedFields.map((f) => [f.key, f.type]));

    // sanitize values to template keys only and coerce number types
    const sanitized = {};
    for (const k of Object.keys(values || {})) {
      if (allowedKeys.has(k)) {
        const t = typeByKey.get(k);
        const v = values[k];
        sanitized[k] =
          t === "number"
            ? v === "" || v === null || v === undefined
              ? ""
              : Number(v)
            : v;
      }
    }

    // Optionally enforce required fields (non-locked only)
    const missing = nonLockedFields
      .filter((f) => f.required)
      .filter(
        (f) =>
          sanitized[f.key] === undefined ||
          sanitized[f.key] === null ||
          sanitized[f.key] === ""
      )
      .map((f) => f.key);
    if (missing.length)
      return res
        .status(400)
        .json({ error: "Missing required fields", missing });

    const slip = await SalarySlip.findOneAndUpdate(
      { employee: employeeId, company: companyId, month },
      {
        $set: { values: sanitized, updatedBy: me.id },
        $setOnInsert: { createdBy: me.id },
      },
      { upsert: true, new: true }
    );

    // Return with computed fields overlaid
    const employeeFull = await Employee.findById(employeeId).select("ctc");
    const lockedVals = computeLockedValues({
      template,
      employee: employeeFull,
    });
    const valuesOut = overlayDefaults(
      template,
      overlayLocked(
        slip.values instanceof Map
          ? Object.fromEntries(slip.values)
          : slip.values || {},
        lockedVals
      )
    );
    res.json({ slip: { ...slip.toObject(), values: valuesOut } });
  } catch (e) {
    if (e && e.code === 11000) {
      return res.status(409).json({ error: "Duplicate slip" });
    }
    res.status(500).json({ error: "Failed to save slip" });
  }
});

module.exports = router;

// ========== PDF generation helpers and routes ==========

// Build a friendly filename
function safeFilename(name) {
  return String(name || "payslip").replace(/[^a-z0-9\-_.]+/gi, "_");
}

function numberOrZero(v) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Render a salary slip PDF using template + slip values
async function renderSlipPDF({
  res,
  company,
  employee,
  month,
  template,
  slipValues,
}) {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 36, bottom: 40, left: 36, right: 36 },
  });
  const filename = `SalarySlip-${safeFilename(employee?.name)}-${month}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  doc.pipe(res);

  const pageWidth = doc.page.width;
  const margin = doc.page.margins.left;
  const contentWidth = pageWidth - margin * 2;

  const fmtAmount = (n) =>
    `${numberOrZero(n).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  const monthStr = (() => {
    const [y, m] = month.split("-").map((x) => parseInt(x, 10));
    const d = new Date(y, m - 1, 1);
    return d.toLocaleString("en-US", { month: "long", year: "numeric" });
  })();

  const fields = (template?.fields || []).map((f) => ({
    ...f,
    category: f.category || "info",
  }));
  const earnings = fields.filter(
    (f) => f.category === "earning" && f.type === "number"
  );
  const deductions = fields.filter(
    (f) => f.category === "deduction" && f.type === "number"
  );
  const info = fields.filter(
    (f) => f.category !== "earning" && f.category !== "deduction"
  );
  const sum = (list) =>
    list.reduce((acc, f) => acc + numberOrZero(slipValues[f.key]), 0);
  const totalEarnings = sum(earnings);
  const totalDeductions = sum(deductions);
  const netPay = totalEarnings - totalDeductions;

  const GUTTER = 16;
  const LINE = 16;
  const PAD = 10;

  const text = (s, x, y, w, opts = {}) =>
    doc.text(String(s ?? ""), x, y, { width: w, ...opts });
  const keyVal = (k, v, x, y, keyW, valW) => {
    doc.fillColor("#6B7280").font("Helvetica").fontSize(10);
    text(k, x, y, keyW);
    doc.fillColor("#111827").font("Helvetica-Bold").fontSize(10);
    text(`:  ${String(v ?? "-")}`, x + keyW, y, valW);
    doc.fillColor("#000");
  };

  // Letterhead with optional company logo
  const headerY = 24;
  const headerH = 56;
  doc.roundedRect(margin, headerY, contentWidth, headerH, 8).fill("#F9FAFB");
  doc.fillColor("#111827");
  // Try to render a logo if available
  try {
    const logoFile = company?.logoHorizontal || company?.logo || company?.logoSquare;
    if (logoFile) {
      const logoPath = path.join(__dirname, "../../uploads", String(logoFile));
      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, margin + 10, headerY + 10, { fit: [140, 36], align: "left", valign: "center" });
      }
    }
  } catch (_) {
    // ignore logo issues; continue rendering
  }
  // Company name and month on the right
  doc.font("Helvetica-Bold").fontSize(16).fillColor("#111827");
  text(company?.name || "Company", margin + 160, headerY + 12, contentWidth - 170, { align: "right" });
  doc.font("Helvetica").fontSize(10).fillColor("#6B7280");
  text("Payslip For the Month", margin + 160, headerY + 30, contentWidth - 170, { align: "right" });
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#111827");
  text(monthStr.toUpperCase(), margin + 160, headerY + 42, contentWidth - 170, { align: "right" });
  doc.fillColor("#000");

  const yStart = headerY + headerH + 12;
  const leftW = Math.floor((contentWidth * 2) / 3) - GUTTER / 2;
  const rightW = contentWidth - leftW - GUTTER;
  const xLeft = margin;
  const xRight = margin + leftW + GUTTER;

  doc.roundedRect(xLeft, yStart, leftW, 124, 8).stroke("#E5E7EB");
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#111827");
  text("EMPLOYEE SUMMARY", xLeft + PAD, yStart + PAD, leftW - PAD * 2);

  let y = yStart + PAD + 14;
  const K = 110;
  const V = leftW - PAD * 2 - K;
  const pairs = [
    ["Employee Name", employee?.name || "-"],
    ["Designation", slipValues["designation"] || "-"],
    ["Employee ID", employee?.employeeId || "-"],
    ["Date of Joining", slipValues["date_of_joining"] || "-"],
    ["Pay Period", monthStr],
    ["Pay Date", slipValues["pay_date"] || lastDayOfMonthString(month)],
  ];
  pairs.forEach(([k, v]) => {
    keyVal(k, v, xLeft + PAD, y, K, V);
    y += LINE;
  });

  doc.roundedRect(xRight, yStart, rightW, 124, 8).stroke("#E5E7EB");
  doc
    .roundedRect(xRight + PAD, yStart + PAD, rightW - PAD * 2, 56, 8)
    .fill("#D1FAE5");
  doc.fillColor("#065F46").font("Helvetica-Bold").fontSize(16);
  text(fmtAmount(netPay), xRight + PAD, yStart + PAD + 16, rightW - PAD * 2, {
    align: "center",
  });
  doc.font("Helvetica").fontSize(10);
  text("Employee Net Pay", xRight + PAD, yStart + PAD + 36, rightW - PAD * 2, {
    align: "center",
  });

  const paidDays = slipValues["paid_days"] ?? "-";
  const lopDays = slipValues["lop_days"] ?? "-";
  const smallY = yStart + 76;
  const half = (rightW - PAD * 2) / 2;

  doc
    .fillColor("#000")
    .roundedRect(xRight + PAD, smallY, rightW - PAD * 2, 36, 6)
    .stroke("#E5E7EB");
  doc.font("Helvetica").fontSize(10).fillColor("#6B7280");
  text("Paid Days", xRight + PAD + 8, smallY + 8, half - 16);
  text("LOP Days", xRight + PAD + half + 8, smallY + 8, half - 16);
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#111827");
  text(String(paidDays), xRight + PAD + 8, smallY + 20, half - 16);
  text(String(lopDays), xRight + PAD + half + 8, smallY + 20, half - 16);
  doc.fillColor("#000");

  const pfY = yStart + 136;
  const pf = slipValues["pf_ac_number"] || "-";
  const uan = slipValues["uan"] || "-";
  doc.font("Helvetica").fontSize(10).fillColor("#6B7280");
  text("PF A/C Number", xLeft, pfY, 100);
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#111827");
  text(`:  ${pf}`, xLeft + 80, pfY, leftW / 2 - 100 - 6);
  doc.font("Helvetica").fontSize(10).fillColor("#6B7280");
  text("UAN", xLeft + leftW - 160, pfY, 60, { align: "right" });
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#111827");
  text(`:  ${uan}`, xLeft + leftW - 92, pfY, 92, { align: "left" });
  doc.fillColor("#000");

  const tableTop = pfY + 24;
  const colW = Math.floor((contentWidth - GUTTER) / 2);
  const xTableLeft = margin;
  const xTableRight = margin + colW + GUTTER;

  const head = (title, x, y) => {
    doc.roundedRect(x, y, colW, 26, 6).fill("#F3F4F6");
    doc.fillColor("#111827").font("Helvetica-Bold").fontSize(11);
    text(title.toUpperCase(), x + PAD, y + 6, colW - PAD * 2);
    doc.font("Helvetica").fontSize(9).fillColor("#6B7280");
    text("AMOUNT", x + colW - 150, y + 7, 70, { align: "right" });
    text("YTD", x + colW - 70, y + 7, 60, { align: "right" });
    doc.fillColor("#000");
  };

  const rowBlock = (items, x, y, ytd) => {
    let yy = y + 28;
    const labelW = colW - 170 - PAD;
    items.length === 0 &&
      (doc.font("Helvetica").fontSize(10).fillColor("#111827"),
      text("—", x + PAD, yy, labelW),
      (yy += LINE));
    items.forEach((f) => {
      const amount = numberOrZero(slipValues[f.key]);
      const ytdVal = numberOrZero(ytd[f.key]);
      doc.font("Helvetica").fontSize(10).fillColor("#111827");
      text(f.label || f.key, x + PAD, yy, labelW);
      text(fmtAmount(amount), x + colW - 150, yy, 70, { align: "right" });
      doc.fillColor("#6B7280");
      text(fmtAmount(ytdVal), x + colW - 70, yy, 60, { align: "right" });
      doc.fillColor("#000");
      yy += LINE;
    });
    return yy;
  };

  const [year, m] = month.split("-").map((x) => parseInt(x, 10));
  const ytdMap = await computeYTD(
    employee._id || employee.id,
    company._id || company.id,
    year,
    m
  );

  head("Earnings", xTableLeft, tableTop);
  const yAfterEarn = rowBlock(earnings, xTableLeft, tableTop, ytdMap);
  head("Deductions", xTableRight, tableTop);
  const yAfterDed = rowBlock(deductions, xTableRight, tableTop, ytdMap);
  const yAfterTables = Math.max(yAfterEarn, yAfterDed) + 6;

  doc.roundedRect(xTableLeft, yAfterTables, colW, 26, 6).fill("#F9FAFB");
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#111827");
  text("Gross Earnings", xTableLeft + PAD, yAfterTables + 7, colW - 150 - PAD);
  text(
    fmtAmount(totalEarnings),
    xTableLeft + colW - 150,
    yAfterTables + 7,
    70,
    { align: "right" }
  );

  doc.roundedRect(xTableRight, yAfterTables, colW, 26, 6).fill("#F9FAFB");
  doc.font("Helvetica").fontSize(9).fillColor("#6B7280");
  text(
    "Total Deductions",
    xTableRight + PAD,
    yAfterTables + 8,
    colW - 80 - PAD
  );
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#111827");
  text(
    fmtAmount(totalDeductions),
    xTableRight + colW - 80,
    yAfterTables + 7,
    70,
    { align: "right" }
  );
  doc.fillColor("#000");

  const yNet = yAfterTables + 38;
  doc.roundedRect(margin, yNet, contentWidth, 38, 8).stroke("#E5E7EB");
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#111827");
  text("TOTAL NET PAYABLE", margin + PAD, yNet + 11, 180);
  doc.font("Helvetica").fontSize(9).fillColor("#6B7280");
  text("Gross Earnings - Total Deductions", margin + 180, yNet + 12, 240);
  doc.fillColor("#065F46").font("Helvetica-Bold").fontSize(12);
  text(fmtAmount(netPay), margin + contentWidth - 140, yNet + 10, 130, {
    align: "right",
  });
  doc.fillColor("#000");

  const yWords = yNet + 46;

  doc.font("Helvetica").fontSize(8).fillColor("#9CA3AF");
  text(
    "— This payslip is system generated and does not require a signature —",
    margin,
    yWords + 18,
    contentWidth,
    { align: "center" }
  );
  doc.fillColor("#000");

  doc.end();
}

function lastDayOfMonthString(month) {
  const [y, m] = month.split("-").map((x) => parseInt(x, 10));
  const d = new Date(y, m, 0);
  return d.toLocaleDateString("en-GB");
}

async function computeYTD(employeeId, companyId, year, uptoMonth) {
  const prefix = `${year}-`;
  const slips = await SalarySlip.find({
    employee: employeeId,
    company: companyId,
    month: { $regex: `^${prefix}` },
  }).lean();
  const map = {};
  for (const s of slips) {
    const [yy, mm] = String(s.month || "")
      .split("-")
      .map((x) => parseInt(x, 10));
    if (yy !== year || !mm || mm > uptoMonth) continue;
    const entries =
      s.values instanceof Map
        ? Array.from(s.values.entries())
        : Object.entries(s.values || {});
    for (const [k, v] of entries) {
      const n = numberOrZero(v);
      map[k] = numberOrZero(map[k]) + n;
    }
  }
  return map;
}

// Minimal number to words for Indian system
function amountInWordsIndian(num) {
  if (!Number.isFinite(num)) return "-";
  if (num === 0) return "Zero";
  const belowTwenty = [
    "",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
  ];
  const tens = [
    "",
    "",
    "Twenty",
    "Thirty",
    "Forty",
    "Fifty",
    "Sixty",
    "Seventy",
    "Eighty",
    "Ninety",
  ];
  function two(n) {
    if (n < 20) return belowTwenty[n];
    const t = Math.floor(n / 10);
    const r = n % 10;
    return tens[t] + (r ? " " + belowTwenty[r] : "");
  }
  function three(n) {
    if (n === 0) return "";
    if (n < 100) return two(n);
    const h = Math.floor(n / 100);
    const r = n % 100;
    return belowTwenty[h] + " Hundred" + (r ? " " + two(r) : "");
  }
  let out = "";
  const crore = Math.floor(num / 10000000);
  num %= 10000000;
  const lakh = Math.floor(num / 100000);
  num %= 100000;
  const thousand = Math.floor(num / 1000);
  num %= 1000;
  const hundred = num;
  if (crore) out += three(crore) + " Crore ";
  if (lakh) out += three(lakh) + " Lakh ";
  if (thousand) out += two(thousand) + " Thousand ";
  if (hundred) out += three(hundred);
  return out.trim();
}

// Download PDF for selected employee (admin/hr/manager or self if matches)
router.get("/slips/pdf", auth, async (req, res) => {
  try {
    let { employeeId, month } = req.query;
    if (!monthValid(month))
      return res.status(400).json({ error: "Invalid month" });
    if (!employeeId) employeeId = req.employee.id;
    if (!(await canManageFor(req, employeeId)))
      return res.status(403).json({ error: "Forbidden" });

    const employee = await Employee.findById(employeeId).select(
      "name email employeeId company ctc"
    );
    if (!employee) return res.status(404).json({ error: "Employee not found" });
    const companyId = req.employee.company || employee.company;
    if (!companyId || !employee.company.equals(companyId))
      return res.status(403).json({ error: "Forbidden" });

    const [company, templateRaw, slip] = await Promise.all([
      Company.findById(companyId).lean(),
      SalaryTemplate.findOne({ company: companyId }).lean(),
      SalarySlip.findOne({
        employee: employeeId,
        company: companyId,
        month,
      }).lean(),
    ]);
    const template = ensureTemplateDefaults(templateRaw || {});
    const valuesObj = {};
    const raw = slip?.values || {};
    const entries =
      raw instanceof Map ? Array.from(raw.entries()) : Object.entries(raw);
    for (const [k, v] of entries) valuesObj[k] = v;
    const lockedVals = computeLockedValues({ template, employee });
    const finalVals = overlayDefaults(
      template,
      overlayLocked(valuesObj, lockedVals)
    );

    await renderSlipPDF({
      res,
      company,
      employee,
      month,
      template,
      slipValues: finalVals,
    });
  } catch (e) {
    console.error("payslip pdf error", e);
    res.status(500).json({ error: "Failed to generate PDF" });
  }
});

// Self shortcut: download my slip
router.get("/slips/mine/pdf", auth, async (req, res) => {
  try {
    const { month } = req.query;
    if (!monthValid(month))
      return res.status(400).json({ error: "Invalid month" });
    const employeeId = req.employee.id;
    const companyId = req.employee.company;
    if (!companyId) return res.status(400).json({ error: "Company not found" });

    const [employee, company, templateRaw, slip] = await Promise.all([
      Employee.findById(employeeId).select("name email employeeId company"),
      Company.findById(companyId).lean(),
      SalaryTemplate.findOne({ company: companyId }).lean(),
      SalarySlip.findOne({
        employee: employeeId,
        company: companyId,
        month,
      }).lean(),
    ]);
    const template = ensureTemplateDefaults(templateRaw || {});
    const valuesObj = {};
    const raw = slip?.values || {};
    const entries =
      raw instanceof Map ? Array.from(raw.entries()) : Object.entries(raw);
    for (const [k, v] of entries) valuesObj[k] = v;
    const lockedVals = computeLockedValues({
      template,
      employee: await Employee.findById(employeeId).select("ctc"),
    });
    const finalVals = overlayDefaults(
      template,
      overlayLocked(valuesObj, lockedVals)
    );

    await renderSlipPDF({
      res,
      company,
      employee,
      month,
      template,
      slipValues: finalVals,
    });
  } catch (e) {
    console.error("my payslip pdf error", e);
    res.status(500).json({ error: "Failed to generate PDF" });
  }
});
