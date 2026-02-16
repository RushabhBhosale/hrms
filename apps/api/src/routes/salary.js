const router = require("express").Router();
const mongoose = require("mongoose");
const { auth } = require("../middleware/auth");
const { requirePrimary, requireAnySub } = require("../middleware/roles");
const { loadFileBuffer } = require("../utils/fileStorage");
const Company = require("../models/Company");
const Employee = require("../models/Employee");
const SalaryTemplate = require("../models/SalaryTemplate");
const SalarySlip = require("../models/SalarySlip");
const UnpaidLeaveAdjustment = require("../models/UnpaidLeaveAdjustment");
const PDFDocument = require("pdfkit");
const Attendance = require("../models/Attendance");
const Leave = require("../models/Leave");
const CompanyDayOverride = require("../models/CompanyDayOverride");
const { sendMail, isEmailEnabled } = require("../utils/mailer");
const {
  DEFAULT_SANDWICH_MIN_DAYS,
  normalizeSandwichMinDays,
} = require("../utils/sandwich");
const { computeUnpaidTakenForMonth } = require("../utils/unpaidLeaves");

function sendSuccess(res, message, payload = {}) {
  if (message) res.set("X-Success-Message", message);
  return res.json({ message, ...payload });
}

function monthValid(m) {
  return typeof m === "string" && /^\d{4}-\d{2}$/.test(m);
}

function monthKeyFromDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function isMonthBeforeStart(month, employee) {
  if (!monthValid(month) || !employee) return false;
  const startMonth = monthKeyFromDate(employee.joiningDate);
  if (!startMonth) return false; // no joining date set, don't block
  return month < startMonth;
}

function getDayThresholds(workHours) {
  const wh = workHours || {};
  const rawFull =
    Number.isFinite(wh?.minFullDayHours) && wh.minFullDayHours > 0
      ? wh.minFullDayHours
      : 6;
  const rawHalf =
    Number.isFinite(wh?.minHalfDayHours) && wh.minHalfDayHours >= 0
      ? wh.minHalfDayHours
      : 3;
  const fullHours = rawFull;
  const halfHours = Math.min(rawHalf, fullHours);
  return {
    fullHours,
    halfHours,
    fullMs: fullHours * 3600000,
    halfMs: halfHours * 3600000,
  };
}

function getSandwichPolicy(leavePolicy) {
  const cfg = leavePolicy?.sandwich || {};
  const enabled = !!cfg.enabled;
  const minDays = normalizeSandwichMinDays(
    cfg.minDays,
    DEFAULT_SANDWICH_MIN_DAYS
  );
  return { enabled, minDays };
}

function shouldApplySandwichRange(rangeStart, rangeEnd, policy) {
  if (!policy?.enabled) return false;
  const s = startOfDay(rangeStart);
  const e = startOfDay(rangeEnd);
  if (e < s) return false;
  const totalDays = Math.floor((e.getTime() - s.getTime()) / 86400000) + 1;
  return totalDays > policy.minDays;
}

function formatRoleLabel(raw) {
  if (!raw) return "";
  return String(raw)
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDisplayDate(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB");
}

function normalizePan(value) {
  if (!value && value !== 0) return "";
  return String(value).replace(/\s+/g, "").toUpperCase();
}

function normalizeUan(value) {
  if (!value && value !== 0) return "";
  const digits = String(value).replace(/\D/g, "");
  return digits.length ? digits : "";
}

// Default locked keys and helpers
const BASIC_KEY = "basic_earned";
const HRA_KEY = "hra";
const MEDICAL_KEY = "medical";
const OTHER_KEY = "other_allowances";
const LOCKED_EARNING_KEYS = new Set([BASIC_KEY, HRA_KEY, MEDICAL_KEY, OTHER_KEY]);

function defaultLockedFields() {
  return [
    {
      key: BASIC_KEY,
      label: "Basic Earned",
      type: "number",
      amountType: "fixed",
      required: true,
      locked: true,
      category: "earning",
      order: 0,
    },
    {
      key: HRA_KEY,
      label: "HRA",
      type: "number",
      amountType: "fixed",
      required: true,
      locked: true,
      category: "earning",
      order: 1,
    },
    {
      key: MEDICAL_KEY,
      label: "Medical",
      type: "number",
      amountType: "fixed",
      required: false,
      locked: true,
      category: "earning",
      order: 2,
    },
    {
      key: OTHER_KEY,
      label: "Other Allowances",
      type: "number",
      amountType: "fixed",
      required: false,
      locked: true,
      category: "earning",
      order: 3,
    },
    // System deduction for loss-of-pay based on absence/half-days
    {
      key: "lop_deduction",
      label: "LOP Deduction",
      type: "number",
      amountType: "fixed",
      required: false,
      locked: true,
      category: "deduction",
      order: 50,
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
    let tpl = await SalaryTemplate.findOne({
      company: companyId,
      isDeleted: { $ne: true },
      isActive: { $ne: false },
    }).lean();
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
          amountType: ["fixed", "percent"].includes(f.amountType)
            ? f.amountType
            : "fixed",
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
          isDeleted: false,
          isActive: true,
        },
        { upsert: true, new: true }
      );

      sendSuccess(res, "Salary template saved", {
        template: ensureTemplateDefaults(tpl.toObject()),
      });
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

function applyPercentFieldValues(values, template, employee, options = {}) {
  const base = numberOrZero(employee?.ctc);
  const assumeRawPercent = !!options.assumeRawPercent;
  const fixOverblown = !!options.fixOverblown;
  const out = { ...(values || {}) };
  const fields = template?.fields || [];
  for (const field of fields) {
    if (!field || field.type !== "number" || field.amountType !== "percent")
      continue;
    const key = field.key;
    if (!key) continue;
    const raw = numberOrZero(out[key]);
    // If we know values are raw percents (e.g., defaults/new slip), always convert.
    // For existing slips, only convert if the stored value still looks like a percent (<=100).
    const looksPercent = assumeRawPercent || raw <= 100;
    // Recover from previously over-converted values: if a percent field is stored as an amount
    // that is wildly higher than the monthly CTC, re-derive it from the template default percent.
    const looksOverblown =
      fixOverblown && base > 0 && raw > base * 10; // 10x CTC is clearly wrong for a percent field

    if (!looksPercent && !looksOverblown) continue;

    let percentValue = raw;
    if (looksOverblown) {
      const defaultPercent = numberOrZero(field.defaultValue);
      if (defaultPercent > 0 && defaultPercent <= 1000) {
        percentValue = defaultPercent;
      } else if (!looksPercent) {
        // Cap at 100% of CTC to avoid cascading explosions when no sensible default is available.
        percentValue = 100;
      }
    }

    out[key] = round2((percentValue / 100) * base);
  }
  return out;
}

function roundEarningsWithCarry({ template, values, employee }) {
  if (!template || !values) return values || {};
  const earningFields = (template.fields || []).filter(
    (f) => f && f.category === "earning" && f.type === "number"
  );
  const hasOther = earningFields.some((f) => f?.key === OTHER_KEY);
  if (!earningFields.length || !hasOther) return values || {};

  const totalEarnings = earningFields.reduce(
    (acc, f) => acc + numberOrZero(values[f.key]),
    0
  );
  const targetTotal = Math.round(
    numberOrZero(employee?.ctc) || numberOrZero(totalEarnings)
  );
  if (targetTotal <= 0) return values || {};

  const out = { ...values };
  let sumRounded = 0;

  for (const field of earningFields) {
    if (!field?.key || field.key === OTHER_KEY) continue;
    const rounded = Math.floor(numberOrZero(values[field.key]));
    out[field.key] = rounded;
    sumRounded += rounded;
  }

  if (sumRounded > targetTotal) return values || {};

  out[OTHER_KEY] = targetTotal - sumRounded;
  return out;
}

function rebalanceOtherAllowances({ template, values, employee }) {
  const baseCtc = numberOrZero(employee?.ctc);
  if (!template || !values || !baseCtc) return values || {};
  const fields = template.fields || [];
  const earningFields = fields.filter(
    (f) => f && f.category === "earning" && f.type === "number"
  );
  const hasOther = earningFields.some((f) => f?.key === OTHER_KEY);
  if (!hasOther) return values || {};
  const extraEarnings = earningFields
    .filter((f) => f.key && !LOCKED_EARNING_KEYS.has(f.key))
    .reduce((acc, f) => acc + numberOrZero(values[f.key]), 0);
  const basic = numberOrZero(values[BASIC_KEY]);
  const hra = numberOrZero(values[HRA_KEY]);
  const medical = numberOrZero(values[MEDICAL_KEY]);
  const nextOther = Math.max(
    0,
    round2(baseCtc - (basic + hra + medical + extraEarnings))
  );
  return roundEarningsWithCarry({
    template,
    employee,
    values: { ...values, [OTHER_KEY]: nextOther },
  });
}

async function buildSlipMetadata({
  employeeId,
  companyId,
  month,
  employee,
  values,
}) {
  const payload = {};

  let manualDeductionDays = null;
  try {
    const adjustment = await UnpaidLeaveAdjustment.findOne({
      company: companyId,
      employee: employeeId,
      month,
    }).lean();
    if (adjustment) {
      manualDeductionDays = Number(adjustment?.deducted || 0);
    }
  } catch (_) {
    manualDeductionDays = null;
  }

  const monthDays = 30; // payroll days include weekends
  const hasManual =
    manualDeductionDays !== null && manualDeductionDays !== undefined;
  const manualValue = hasManual ? numberOrZero(manualDeductionDays) : 0;
  const cappedLopDays = Math.min(monthDays, Math.max(0, round2(manualValue)));
  const computedPaidDays = Math.max(0, round2(monthDays - cappedLopDays));
  const perDay = numberOrZero(employee?.ctc) / monthDays;

  payload.paid_days = computedPaidDays;
  payload.lop_days = cappedLopDays;
  payload.lop_deduction = round2(perDay * cappedLopDays);
  payload.unpaid_taken = 0; // no automatic deductions; only admin adjustments apply
  payload.unpaid_deducted = cappedLopDays;

  // Employee metadata
  const existing = values || {};
  const payDate = existing.pay_date || payDateForMonth(month);
  if (payDate) payload.pay_date = payDate;

  const joining = existing.date_of_joining || employee?.joiningDate || employee?.createdAt;
  const joiningFormatted = formatDisplayDate(joining);
  if (joiningFormatted) payload.date_of_joining = joiningFormatted;

  const designationRaw =
    existing.designation ||
    employee?.subRoles?.[0] ||
    employee?.primaryRole ||
    "";
  const designation = formatRoleLabel(designationRaw);
  if (designation) payload.designation = designation;

  const pan =
    existing.pan_number ||
    normalizePan(employee?.panNumber || employee?.pan_number || employee?.pan);
  if (pan) payload.pan_number = pan;

  const uan =
    existing.uan || normalizeUan(employee?.uan || employee?.uan_number);
  if (uan) payload.uan = uan;

  return payload;
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

function grossFromValues(template, slipValues, employeeCtc) {
  const fields = template?.fields || [];
  const sumFromFields = fields
    .filter((f) => f?.category === "earning" && f?.type === "number")
    .reduce((acc, f) => acc + numberOrZero(slipValues?.[f.key]), 0);
  const gross = numberOrZero(sumFromFields);
  if (gross > 0) return gross;
  // Fallback to employee CTC if earnings not populated yet
  const ctc = numberOrZero(employeeCtc);
  return ctc > 0 ? ctc : 0;
}

// --- helpers for date handling (server local) ---
function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function dateKeyLocal(d) {
  const x = startOfDay(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Compute paid days and LOP (loss of pay) days for a month
// Uses a 30-day payroll month; weekends are paid by default, but pre-joining days are LOP.
// LOP days count: 1 for full leave/absence, 0.5 for half-day work or company half-day overrides
async function computePaidAndLopDays({ employeeId, companyId, month }) {
  const start = startOfDay(new Date(`${month}-01`));
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  const monthDays = 30;

  // Load company holidays + overrides, attendance, employee start date, and approved leaves
  const [company, overrides, records, leaves, employee] = await Promise.all([
    Company.findById(companyId)
      .select("bankHolidays workHours leavePolicy")
      .lean(),
    CompanyDayOverride.find({
      company: companyId,
      date: { $gte: start, $lt: end },
      isDeleted: { $ne: true },
      isActive: { $ne: false },
    })
      .select("date type")
      .lean(),
    Attendance.find({ employee: employeeId, date: { $gte: start, $lt: end } }).lean(),
    Leave.find({
      employee: employeeId,
      status: "APPROVED",
      startDate: { $lte: end },
      endDate: { $gte: start },
    })
      .select("startDate endDate")
      .lean(),
    Employee.findById(employeeId).select("joiningDate"),
  ]);

  try { employee?.decryptFieldsSync?.(); } catch (_) {}
  const employmentStartRaw = employee?.joiningDate;
  const employmentStart = employmentStartRaw ? startOfDay(employmentStartRaw) : null;
  const rangeStart =
    employmentStart && employmentStart > start ? employmentStart : start;
  const preStartDays = employmentStart
    ? Math.max(0, Math.min(monthDays, Math.floor((employmentStart - start) / 86400000)))
    : 0;

  const ovByKey = new Map((overrides || []).map((o) => [dateKeyLocal(o.date), o]));
  const bankHolidaySet = new Set(
    (company?.bankHolidays || []).map((h) => dateKeyLocal(h.date))
  );

  // Build attendance map by day key
  const recByKey = new Map((records || []).map((r) => [dateKeyLocal(r.date), r]));

  // Build approved leave day set (no half-day metadata in Leave model, so mark entire dates)
  const approvedLeaveSet = new Set();
  const sandwichPolicy = getSandwichPolicy(company?.leavePolicy);
  const sandwichDaySet = new Set();
  for (const l of leaves || []) {
    let s = startOfDay(new Date(l.startDate));
    let e = startOfDay(new Date(l.endDate));
    if (employmentStart && e < employmentStart) continue;
    if (employmentStart && s < employmentStart) s = employmentStart;
    if (s < start) s = start;
    if (e > end) e = new Date(end.getTime() - 1);
    const applySandwich = shouldApplySandwichRange(s, e, sandwichPolicy);
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      const key = dateKeyLocal(d);
      const ov = ovByKey.get(key);
      let isWeekend = d.getDay() === 0 || d.getDay() === 6;
      if (ov?.type === "WORKING" || ov?.type === "HALF_DAY") isWeekend = false;
      let isHoliday = bankHolidaySet.has(key) || ov?.type === "HOLIDAY";
      if (ov?.type === "WORKING") isHoliday = false;
      if (applySandwich && (isWeekend || isHoliday)) {
        sandwichDaySet.add(key);
      }
      approvedLeaveSet.add(key);
    }
  }

  const { fullMs: fullDayMs, halfMs: halfDayMs } = getDayThresholds(
    company?.workHours
  );

  let workingDays = 0;
  let totalLopUnits = 0;
  const now = new Date();
  for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
    const key = dateKeyLocal(d);
    const ov = ovByKey.get(key);
    const dow = d.getDay();
    let isWeekend = dow === 0 || dow === 6;
    if (ov?.type === "WORKING") isWeekend = false;
    let isHoliday = bankHolidaySet.has(key) || ov?.type === "HOLIDAY";
    if (ov?.type === "WORKING") isHoliday = false;
    const isSandwichDay = sandwichDaySet.has(key);
    if (isSandwichDay) {
      isWeekend = false;
      isHoliday = false;
    }

    if (d < rangeStart) continue;

    if (!isWeekend && !isHoliday) workingDays += 1;

    // Determine time spent for attendance record
    const rec = recByKey.get(key);
    let timeSpentMs = 0;
    if (rec) {
      timeSpentMs = rec.workedMs || 0;
      if (rec.lastPunchIn && !rec.lastPunchOut) {
        const recDay = startOfDay(new Date(rec.date));
        if (recDay.getTime() === startOfDay(now).getTime()) {
          timeSpentMs += now.getTime() - new Date(rec.lastPunchIn).getTime();
        }
      }
      if (!timeSpentMs && rec.firstPunchIn && rec.lastPunchOut) {
        timeSpentMs =
          new Date(rec.lastPunchOut).getTime() -
          new Date(rec.firstPunchIn).getTime();
      }
    }

    let leaveUnit = 0;
    if (!isWeekend && !isHoliday) {
      const hasWork = !!rec && timeSpentMs > 0;
      const meetsFullDay = timeSpentMs >= fullDayMs;
      const meetsHalfDay = !meetsFullDay && timeSpentMs >= halfDayMs;
      const isApprovedLeave = approvedLeaveSet.has(key);

      if (hasWork) {
        if (meetsFullDay) {
          leaveUnit = 0;
        } else if (meetsHalfDay) {
          leaveUnit = 0.5;
        } else {
          leaveUnit = 1;
        }
      } else if (isApprovedLeave) {
        leaveUnit = 1;
      } else {
        // Absent day with no work and no approved leave
        leaveUnit = 1;
      }

      // Company half-day override: if no work recorded, count as 0.5
      if (ov?.type === "HALF_DAY" && !hasWork) {
        // If previously counted as 1 due to absence, reduce to 0.5
        leaveUnit = Math.min(leaveUnit, 0.5);
        if (leaveUnit === 0) leaveUnit = 0.5;
      }
    }

    totalLopUnits += leaveUnit;
  }

  const attendanceLopDays = round2(totalLopUnits);
  const lopDays = round2(preStartDays + attendanceLopDays);
  const paidDays = Math.max(0, round2(monthDays - lopDays));
  return {
    paidDays,
    lopDays,
    attendanceLopDays,
    preStartDays,
    workingDays,
  };
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
    const employee = await Employee.findById(employeeId).select(
      "company ctc __enc_ctc __enc_ctc_d joiningDate createdAt email name employeeId subRoles primaryRole panNumber __enc_panNumber uan __enc_uan"
    );
    try { employee?.decryptFieldsSync?.(); } catch (_) {}
    if (!employee) return res.status(404).json({ error: "Employee not found" });
    const companyId = req.employee.company || employee.company;
    if (!companyId || !employee.company.equals(companyId))
      return res.status(403).json({ error: "Forbidden" });

    if (isMonthBeforeStart(month, employee)) {
      return res
        .status(400)
        .json({ error: "Salary slip not available for this period" });
    }

    const [tpl, slipDoc] = await Promise.all([
      SalaryTemplate.findOne({
        company: companyId,
        isDeleted: { $ne: true },
        isActive: { $ne: false },
      }).lean(),
      SalarySlip.findOne({
        employee: employeeId,
        company: companyId,
        month,
        isDeleted: { $ne: true },
        isActive: { $ne: false },
      }),
    ]);

    const template = ensureTemplateDefaults(
      tpl || { company: companyId, fields: [] }
    );
    if (slipDoc) slipDoc.decryptFieldsSync();
    const slip = slipDoc ? slipDoc.toObject() : null;
    const rawVals = slip?.values || {};
    const lockedVals = computeLockedValues({ template, employee });
    let values = overlayDefaults(
      template,
      overlayLocked(
        rawVals instanceof Map ? Object.fromEntries(rawVals) : rawVals,
        lockedVals
      )
    );

    try {
      const meta = await buildSlipMetadata({
        employeeId,
        companyId,
        month,
        employee,
        values,
      });
      values = { ...values, ...meta };
    } catch (_) {}

    const valuesForResponse = rebalanceOtherAllowances({
      template,
      employee,
      values: applyPercentFieldValues(values, template, employee, {
        assumeRawPercent: !slip,
        fixOverblown: true,
      }),
    });

    res.json({
      template,
      slip: slip
        ? { ...slip, values: valuesForResponse }
        : {
            employee: employeeId,
            company: companyId,
            month,
            values: valuesForResponse,
          },
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
    const [employee, tpl, slipDoc] = await Promise.all([
      (async () => {
        const e = await Employee.findById(employeeId).select(
          "ctc __enc_ctc __enc_ctc_d joiningDate createdAt email name employeeId subRoles primaryRole panNumber __enc_panNumber uan __enc_uan"
        );
        try { e?.decryptFieldsSync?.(); } catch (_) {}
        return e;
      })(),
      SalaryTemplate.findOne({
        company: companyId,
        isDeleted: { $ne: true },
        isActive: { $ne: false },
      }).lean(),
      SalarySlip.findOne({
        employee: employeeId,
        company: companyId,
        month,
        isDeleted: { $ne: true },
        isActive: { $ne: false },
      }),
    ]);
    if (isMonthBeforeStart(month, employee)) {
      return res
        .status(400)
        .json({ error: "Salary slip not available for this period" });
    }

    const template = ensureTemplateDefaults(
      tpl || { company: companyId, fields: [] }
    );
    if (slipDoc) slipDoc.decryptFieldsSync();
    const slip = slipDoc ? slipDoc.toObject() : null;
    const rawVals = slip?.values || {};
    const lockedVals = computeLockedValues({ template, employee });
    let values = overlayDefaults(
      template,
      overlayLocked(
        rawVals instanceof Map ? Object.fromEntries(rawVals) : rawVals,
        lockedVals
      )
    );
    try {
      const meta = await buildSlipMetadata({
        employeeId,
        companyId,
        month,
        employee,
        values,
      });
      values = { ...values, ...meta };
    } catch (_) {}
    const valuesForResponse = rebalanceOtherAllowances({
      template,
      employee,
      values: applyPercentFieldValues(values, template, employee, {
        assumeRawPercent: !slip,
        fixOverblown: true,
      }),
    });
    res.json({
      template,
      slip: slip
        ? { ...slip, values: valuesForResponse }
        : {
            employee: employeeId,
            company: companyId,
            month,
            values: valuesForResponse,
          },
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

    const employeeDoc = await Employee.findById(employeeId).select(
      "company name email employeeId joiningDate createdAt ctc __enc_ctc __enc_ctc_d subRoles primaryRole panNumber __enc_panNumber uan __enc_uan"
    );
    try { employeeDoc?.decryptFieldsSync?.(); } catch (_) {}
    if (!employeeDoc)
      return res.status(404).json({ error: "Employee not found" });
    const companyId = me.company || employeeDoc.company;
    if (!companyId || !employeeDoc.company.equals(companyId))
      return res.status(403).json({ error: "Forbidden" });

    if (isMonthBeforeStart(month, employeeDoc)) {
      return res
        .status(400)
        .json({ error: "Salary slip not available for this period" });
    }

    const tpl = await SalaryTemplate.findOne({
      company: companyId,
      isDeleted: { $ne: true },
      isActive: { $ne: false },
    }).lean();
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

    const normalizedValues = applyPercentFieldValues(
      sanitized,
      template,
      employeeDoc,
      { fixOverblown: true }
    );

    const slip = await SalarySlip.findOneAndUpdate(
      { employee: employeeId, company: companyId, month },
      {
        $set: { values: normalizedValues, updatedBy: me.id },
        $setOnInsert: { createdBy: me.id },
      },
      { upsert: true, new: true }
    );

    // Return with computed fields overlaid
    if (slip) {
      // Ensure encrypted fields are available on doc
      slip.decryptFieldsSync();
    }
    const lockedVals = computeLockedValues({
      template,
      employee: employeeDoc,
    });
    let valuesOut = overlayDefaults(
      template,
      overlayLocked(
        slip.values instanceof Map
          ? Object.fromEntries(slip.values)
          : slip.values || {},
        lockedVals
      )
    );
    try {
      const meta = await buildSlipMetadata({
        employeeId,
        companyId,
        month,
        employee: employeeDoc,
        values: valuesOut,
      });
      valuesOut = { ...valuesOut, ...meta };
    } catch (_) {}
    valuesOut = rebalanceOtherAllowances({
      template,
      values: valuesOut,
      employee: employeeDoc,
    });
    const responsePayload = { slip: { ...slip.toObject(), values: valuesOut } };
    sendSuccess(res, "Salary slip saved", responsePayload);

    const employeePayload =
      typeof employeeDoc.toObject === "function"
        ? employeeDoc.toObject()
        : employeeDoc;
    sendSalarySlipEmail({
      companyId,
      employee: employeePayload,
      month,
      template,
      slipValues: valuesOut,
    }).catch((err) =>
      console.warn(
        "[salary] slip email async error:",
        err?.message || err
      )
    );
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

function formatMonthLabel(month) {
  if (!monthValid(month)) return month;
  const [y, m] = month.split("-").map((x) => parseInt(x, 10));
  const d = new Date(y, m - 1, 1);
  return d.toLocaleString("en-US", { month: "long", year: "numeric" });
}

async function sendSalarySlipEmail({
  companyId,
  employee,
  month,
  template,
  slipValues,
}) {
  try {
    if (!employee?.email) return;
    const enabled = await isEmailEnabled(companyId);
    if (!enabled) return;

    const company = await Company.findById(companyId).lean();
    if (!company) return;

    const pdfBuffer = await generateSlipPDFBuffer({
      company,
      employee,
      month,
      template,
      slipValues,
    });

    const monthLabel = formatMonthLabel(month);
    const subject = `${company?.name || "Company"} | Salary Slip - ${monthLabel}`;
    const greetName = employee?.name || employee?.email || "there";
    const filename = `SalarySlip-${safeFilename(employee?.name)}-${month}.pdf`;

    const text = `Hi ${greetName},\n\nYour salary slip for ${monthLabel} is attached.\n\nRegards,\n${company?.name || "HR Team"}`;
    const html = `
      <div style="font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; color:#111827;">
        <p>Hi ${greetName},</p>
        <p>Your salary slip for <strong>${monthLabel}</strong> is attached to this email.</p>
        <p style="color:#6B7280; font-size:12px;">If you have any questions, please reach out to the HR team.</p>
        <p>Regards,<br/>${company?.name || "HR Team"}</p>
      </div>
    `;

    await sendMail({
      companyId,
      to: employee.email,
      subject,
      text,
      html,
      attachments: [
        {
          filename,
          content: pdfBuffer,
        },
      ],
    });
  } catch (err) {
    console.warn(
      "[salary] Failed to send salary slip email:",
      err?.message || err
    );
  }
}

function drawSlipPDF(doc, { company, employee, month, template, slipValues, logoBuffer }) {
  const pageWidth = doc.page.width;
  const margin = doc.page.margins.left;
  const contentWidth = pageWidth - margin * 2;

  const fmtAmount = (n) =>
    `${numberOrZero(n).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  const monthShortStr = (() => {
    const [y, m] = month.split("-").map((x) => parseInt(x, 10));
    const d = new Date(y, m - 1, 1);
    return d.toLocaleString("en-US", { month: "short", year: "numeric" });
  })();

  // ---------- fields + canonical ordering ----------
  const fields = (template?.fields || []).map((f) => ({
    ...f,
    category: f.category || "info",
  }));
  const allEarnings = fields.filter(
    (f) => f.category === "earning" && f.type === "number"
  );
  const deductions = fields.filter(
    (f) => f.category === "deduction" && f.type === "number"
  );

  // enforce ordering: basic_earned -> hra -> medical -> (other earnings) -> other_allowances
  const sysFirst = ["basic_earned", "hra", "medical"];
  const lastKey = "other_allowances";
  const earnings = [
    ...sysFirst
      .map((k) => allEarnings.find((f) => f.key === k))
      .filter(Boolean),
    ...allEarnings
      .filter((f) => !sysFirst.includes(f.key) && f.key !== lastKey)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    ...allEarnings.filter((f) => f.key === lastKey),
  ];

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

  // ---------- header ----------
  const headerY = 24;
  const headerH = 68;
  doc.roundedRect(margin, headerY, contentWidth, headerH, 8).fill("#F9FAFB");
  doc.fillColor("#111827");
  try {
    if (logoBuffer) {
      doc.image(logoBuffer, margin + 10, headerY + 14, {
        fit: [140, 40],
        align: "left",
        valign: "center",
      });
    }
  } catch (_) {}
  doc.fillColor("#000");

  // ---------- summary ----------
  const labelY = headerY + headerH + 12;
  doc.font("Helvetica-Bold").fontSize(16).fillColor("#111827");
  text("Salary Slip", margin, labelY, contentWidth, { align: "center" });
  doc.fillColor("#000");

  const yStart = labelY + 28;
  const leftW = Math.floor((contentWidth * 2) / 3) - GUTTER / 2;
  const rightW = contentWidth - leftW - GUTTER;
  const xLeft = margin;
  const xRight = margin + leftW + GUTTER;

  doc.roundedRect(xLeft, yStart, leftW, 140, 8).stroke("#E5E7EB");
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#111827");
  text("EMPLOYEE SUMMARY", xLeft + PAD, yStart + PAD, leftW - PAD * 2);

  let y = yStart + PAD + 16;
  const K = 110;
  const V = leftW - PAD * 2 - K;
  const pairs = [
    ["Employee Name", employee?.name || "-"],
    ["Designation", slipValues["designation"] || "-"],
    ["Employee ID", employee?.employeeId || "-"],
    ["PAN Number", slipValues["pan_number"] || "-"],
    ["Date of Joining", slipValues["date_of_joining"] || "-"],
    ["Pay Period", monthShortStr],
    ["Pay Date", slipValues["pay_date"] || payDateForMonth(month)],
  ];
  pairs.forEach(([k, v]) => {
    keyVal(k, v, xLeft + PAD, y, K, V);
    y += LINE;
  });

  doc.roundedRect(xRight, yStart, rightW, 140, 8).stroke("#E5E7EB");
  doc
    .roundedRect(xRight + PAD, yStart + PAD + 2, rightW - PAD * 2, 60, 8)
    .fill("#D1FAE5");
  doc.fillColor("#065F46").font("Helvetica-Bold").fontSize(16);
  text(fmtAmount(netPay), xRight + PAD, yStart + PAD + 18, rightW - PAD * 2, {
    align: "center",
  });
  doc.font("Helvetica").fontSize(10);
  text("Employee Net Pay", xRight + PAD, yStart + PAD + 40, rightW - PAD * 2, {
    align: "center",
  });

  const paidDays = slipValues["paid_days"] ?? "-";
  const lopDays = slipValues["lop_days"] ?? "-";
  const smallY = yStart + 92;
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

  // PF / UAN line
  const pfY = yStart + 160;
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

  // ---------- tables (no YTD) ----------
  const tableTop = pfY + 30;
  const colW = Math.floor((contentWidth - GUTTER) / 2);
  const xTableLeft = margin;
  const xTableRight = margin + colW + GUTTER;

  const head = (title, x, y) => {
    doc.roundedRect(x, y, colW, 26, 6).fill("#F3F4F6");
    doc.fillColor("#111827").font("Helvetica-Bold").fontSize(11);
    text(title.toUpperCase(), x + PAD, y + 6, colW - PAD * 2);
    doc.font("Helvetica").fontSize(9).fillColor("#6B7280");
    text("AMOUNT", x + colW - 80, y + 7, 70, { align: "right" }); // only amount
    doc.fillColor("#000");
  };

  // dynamic-height rows to avoid overlap on wrapped labels
  const rowBlock = (items, x, y) => {
    let yy = y + 28;
    const labelW = colW - 80 - PAD; // space for 1 number col
    const fontSize = 10;

    if (!items.length) {
      doc.font("Helvetica").fontSize(fontSize).fillColor("#111827");
      text("—", x + PAD, yy, labelW);
      yy += LINE;
      return yy;
    }

    items.forEach((f) => {
      const label = f.label || f.key;
      const amount = numberOrZero(slipValues[f.key]);

      doc.font("Helvetica").fontSize(fontSize);
      const labelH = doc.heightOfString(String(label), {
        width: labelW,
        align: "left",
      });

      const lines = Math.max(1, Math.ceil(labelH / LINE));
      const rowH = lines * LINE;

      doc.fillColor("#111827");
      text(label, x + PAD, yy, labelW);

      doc.fillColor("#111827");
      text(fmtAmount(amount), x + colW - 80, yy, 70, { align: "right" });
      doc.fillColor("#000");

      yy += rowH;
    });

    return yy;
  };

  head("Earnings", xTableLeft, tableTop);
  const yAfterEarn = rowBlock(earnings, xTableLeft, tableTop);
  head("Deductions", xTableRight, tableTop);
  const yAfterDed = rowBlock(deductions, xTableRight, tableTop);
  const yAfterTables = Math.max(yAfterEarn, yAfterDed) + 6;

  // totals
  doc.roundedRect(xTableLeft, yAfterTables, colW, 26, 6).fill("#F9FAFB");
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#111827");
  text("Gross Earnings", xTableLeft + PAD, yAfterTables + 7, colW - 80 - PAD);
  text(fmtAmount(totalEarnings), xTableLeft + colW - 80, yAfterTables + 7, 70, {
    align: "right",
  });

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

  // net
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

  const noteText = String(slipValues["tds_note"] || "").trim();
  let footerBaseY = yNet + 46;
  if (noteText) {
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#111827");
    text("TDS Note", margin, footerBaseY, contentWidth);
    doc.font("Helvetica").fontSize(9).fillColor("#4B5563");
    text(noteText, margin, footerBaseY + 14, contentWidth);
    footerBaseY += 36;
  }

  // footer note
  doc.font("Helvetica").fontSize(8).fillColor("#9CA3AF");
  text(
    "— This payslip is system generated and does not require a signature —",
    margin,
    footerBaseY + 18,
    contentWidth,
    { align: "center" }
  );
  doc.fillColor("#000");
}

async function renderSlipPDF({
  res,
  company,
  employee,
  month,
  template,
  slipValues,
}) {
  const logoBuffer = await loadFileBuffer(
    company?.logoHorizontal || company?.logo || company?.logoSquare
  );
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 36, bottom: 40, left: 36, right: 36 },
  });
  const filename = `SalarySlip-${safeFilename(employee?.name)}-${month}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  doc.pipe(res);
  drawSlipPDF(doc, {
    company,
    employee,
    month,
    template,
    slipValues,
    logoBuffer,
  });
  doc.end();
}

async function generateSlipPDFBuffer({
  company,
  employee,
  month,
  template,
  slipValues,
}) {
  const logoBuffer = await loadFileBuffer(
    company?.logoHorizontal || company?.logo || company?.logoSquare
  );
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 36, bottom: 40, left: 36, right: 36 },
    });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    drawSlipPDF(doc, {
      company,
      employee,
      month,
      template,
      slipValues,
      logoBuffer,
    });
    doc.end();
  });
}

function payDateForMonth(month) {
  if (!monthValid(month)) return "";
  const [y, m] = month.split("-").map((x) => parseInt(x, 10));
  if (!y || !m) return "";
  // First day of the next month
  const d = new Date(y, m, 1);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB");
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
      "name email employeeId company ctc __enc_ctc __enc_ctc_d joiningDate createdAt subRoles primaryRole panNumber __enc_panNumber uan __enc_uan"
    );
    try { employee?.decryptFieldsSync?.(); } catch (_) {}
    if (!employee) return res.status(404).json({ error: "Employee not found" });
    const companyId = req.employee.company || employee.company;
    if (!companyId || !employee.company.equals(companyId))
      return res.status(403).json({ error: "Forbidden" });

    if (isMonthBeforeStart(month, employee)) {
      return res
        .status(400)
        .json({ error: "Salary slip not available for this period" });
    }

    const [company, templateRaw, slipDoc] = await Promise.all([
      Company.findById(companyId).lean(),
      SalaryTemplate.findOne({
        company: companyId,
        isDeleted: { $ne: true },
        isActive: { $ne: false },
      }).lean(),
      SalarySlip.findOne({
        employee: employeeId,
        company: companyId,
        month,
        isDeleted: { $ne: true },
        isActive: { $ne: false },
      }),
    ]);

    const template = ensureTemplateDefaults(templateRaw || {});
    if (slipDoc) slipDoc.decryptFieldsSync();
    const slip = slipDoc ? slipDoc.toObject() : null;
    const valuesObj = {};
    const raw = slip?.values || {};
    const entries =
      raw instanceof Map ? Array.from(raw.entries()) : Object.entries(raw);
    for (const [k, v] of entries) valuesObj[k] = v;
    const lockedVals = computeLockedValues({ template, employee });
    let finalVals = overlayDefaults(
      template,
      overlayLocked(valuesObj, lockedVals)
    );

    try {
      const meta = await buildSlipMetadata({
        employeeId,
        companyId,
        month,
        employee,
        values: finalVals,
      });
      finalVals = { ...finalVals, ...meta };
    } catch (_) {}
    const finalWithPercent = rebalanceOtherAllowances({
      template,
      employee,
      values: applyPercentFieldValues(finalVals, template, employee, {
        assumeRawPercent: !slip,
        fixOverblown: true,
      }),
    });

    await renderSlipPDF({
      res,
      company,
      employee,
      month,
      template,
      slipValues: finalWithPercent,
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

    const [employee, company, templateRaw, slipDoc] = await Promise.all([
      (async () => { const e = await Employee.findById(employeeId).select("name email employeeId company ctc __enc_ctc __enc_ctc_d joiningDate createdAt subRoles primaryRole panNumber __enc_panNumber uan __enc_uan"); try { e?.decryptFieldsSync?.(); } catch (_) {} return e; })(),
      Company.findById(companyId).lean(),
      SalaryTemplate.findOne({
        company: companyId,
        isDeleted: { $ne: true },
        isActive: { $ne: false },
      }).lean(),
      SalarySlip.findOne({
        employee: employeeId,
        company: companyId,
        month,
        isDeleted: { $ne: true },
        isActive: { $ne: false },
      }),
    ]);
    if (isMonthBeforeStart(month, employee)) {
      return res
        .status(400)
        .json({ error: "Salary slip not available for this period" });
    }
    const template = ensureTemplateDefaults(templateRaw || {});
    if (slipDoc) slipDoc.decryptFieldsSync();
    const slip = slipDoc ? slipDoc.toObject() : null;
    const valuesObj = {};
    const raw = slip?.values || {};
    const entries =
      raw instanceof Map ? Array.from(raw.entries()) : Object.entries(raw);
    for (const [k, v] of entries) valuesObj[k] = v;
    const lockedVals = computeLockedValues({
      template,
      employee,
    });
    let finalVals = overlayDefaults(
      template,
      overlayLocked(valuesObj, lockedVals)
    );

    try {
      const meta = await buildSlipMetadata({
        employeeId,
        companyId,
        month,
        employee,
        values: finalVals,
      });
      finalVals = { ...finalVals, ...meta };
    } catch (_) {}
    const finalWithPercent = rebalanceOtherAllowances({
      template,
      employee,
      values: applyPercentFieldValues(finalVals, template, employee, {
        assumeRawPercent: !slip,
        fixOverblown: true,
      }),
    });
    await renderSlipPDF({
      res,
      company,
      employee,
      month,
      template,
      slipValues: finalWithPercent,
    });
  } catch (e) {
    console.error("my payslip pdf error", e);
    res.status(500).json({ error: "Failed to generate PDF" });
  }
});
