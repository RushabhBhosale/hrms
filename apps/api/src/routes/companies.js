const router = require("express").Router();
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const { auth } = require("../middleware/auth");
const Company = require("../models/Company");
const Employee = require("../models/Employee");
const Project = require("../models/Project");
const Task = require("../models/Task");
const CompanyDayOverride = require("../models/CompanyDayOverride");
const SalarySlip = require("../models/SalarySlip");
const multer = require("multer");
const path = require("path");
const upload = multer({ dest: path.join(__dirname, "../../uploads") });
const { syncLeaveBalances } = require("../utils/leaveBalances");

// Utility: simple hex validation
function isHexColor(v) {
  return typeof v === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v.trim());
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// Admin/Employee: get company theme
router.get("/theme", auth, async (req, res) => {
  let company = null;
  if (["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole)) {
    company = await Company.findOne({ admin: req.employee.id }).select("theme");
  } else if (req.employee.primaryRole === "EMPLOYEE") {
    company = await Company.findById(req.employee.company).select("theme");
  }
  if (!company) return res.status(200).json({ theme: null });
  return res.json({ theme: company.theme || null });
});

// Admin/Employee: get company branding (name + logo filename)
router.get("/branding", auth, async (req, res) => {
  try {
    let company = null;
    if (["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole)) {
      company = await Company.findOne({ admin: req.employee.id }).select("name logo logoSquare logoHorizontal");
    } else if (req.employee.primaryRole === "EMPLOYEE") {
      company = await Company.findById(req.employee.company).select("name logo logoSquare logoHorizontal");
    }
    if (!company) return res.status(200).json({ branding: null });
    return res.json({ branding: {
      name: company.name,
      logo: company.logo || null,
      logoSquare: company.logoSquare || null,
      logoHorizontal: company.logoHorizontal || null,
    } });
  } catch (e) {
    return res.status(500).json({ error: "Failed to get branding" });
  }
});

// Admin: update company theme
router.put("/theme", auth, async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });

  const company = await Company.findOne({ admin: req.employee.id });
  if (!company) return res.status(400).json({ error: "Company not found" });

  const allowed = ["primary", "secondary", "accent", "success", "warning", "error"];
  const patch = {};
  for (const k of allowed) {
    const v = req.body?.[k];
    if (v === undefined) continue;
    if (v === null || v === "") continue; // ignore empty
    if (!isHexColor(v)) return res.status(400).json({ error: `Invalid color for ${k}` });
    patch[k] = v.trim();
  }
  company.theme = { ...(company.theme || {}), ...patch };
  await company.save();
  return res.json({ theme: company.theme });
});

// Admin: reset company theme to defaults
router.delete("/theme", auth, async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });

  const company = await Company.findOne({ admin: req.employee.id });
  if (!company) return res.status(400).json({ error: "Company not found" });

  // Remove custom theme so the app falls back to CSS defaults
  company.theme = undefined;
  await company.save();
  return res.json({ theme: null });
});

// Admin: get basic company profile (name)
router.get("/profile", auth, async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });
  const company = await Company.findOne({ admin: req.employee.id }).select("name logo logoSquare logoHorizontal");
  if (!company) return res.status(400).json({ error: "Company not found" });
  res.json({ company: {
    id: company._id,
    name: company.name,
    logo: company.logo || null,
    logoSquare: company.logoSquare || null,
    logoHorizontal: company.logoHorizontal || null,
  } });
});

// Admin: update company name
router.put("/profile", auth, async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });

  const { name } = req.body || {};
  if (typeof name !== "string" || !name.trim())
    return res.status(400).json({ error: "Invalid company name" });

  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 120)
    return res.status(400).json({ error: "Company name must be 2-120 characters" });

  const company = await Company.findOne({ admin: req.employee.id });
  if (!company) return res.status(400).json({ error: "Company not found" });
  company.name = trimmed;
  await company.save();
  res.json({ company: {
    id: company._id,
    name: company.name,
    logo: company.logo || null,
    logoSquare: company.logoSquare || null,
    logoHorizontal: company.logoHorizontal || null,
  } });
});

// Admin: upload or replace company logo
router.post("/logo", auth, upload.single("logo"), async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });
  try {
    if (!req.file) return res.status(400).json({ error: "No logo file uploaded" });
    const company = await Company.findOne({ admin: req.employee.id });
    if (!company) return res.status(400).json({ error: "Company not found" });
    company.logo = req.file.filename;
    await company.save();
    return res.json({ logo: company.logo });
  } catch (e) {
    return res.status(500).json({ error: "Failed to upload logo" });
  }
});

// Admin: upload/replace square logo
router.post("/logo-square", auth, upload.single("logo"), async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });
  try {
    if (!req.file) return res.status(400).json({ error: "No logo file uploaded" });
    const company = await Company.findOne({ admin: req.employee.id });
    if (!company) return res.status(400).json({ error: "Company not found" });
    company.logoSquare = req.file.filename;
    await company.save();
    return res.json({ logoSquare: company.logoSquare });
  } catch (e) {
    return res.status(500).json({ error: "Failed to upload square logo" });
  }
});

// Admin: upload/replace horizontal logo
router.post("/logo-horizontal", auth, upload.single("logo"), async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });
  try {
    if (!req.file) return res.status(400).json({ error: "No logo file uploaded" });
    const company = await Company.findOne({ admin: req.employee.id });
    if (!company) return res.status(400).json({ error: "Company not found" });
    company.logoHorizontal = req.file.filename;
    await company.save();
    return res.json({ logoHorizontal: company.logoHorizontal });
  } catch (e) {
    return res.status(500).json({ error: "Failed to upload horizontal logo" });
  }
});

// Public: company self-registration (landing page submission)
router.post("/register", async (req, res) => {
  try {
    const { companyName, adminName, adminEmail, adminPassword } = req.body || {};
    if (!companyName || !adminName || !adminEmail || !adminPassword) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const existingAdmin = await Employee.findOne({ email: adminEmail });
    if (existingAdmin) {
      return res
        .status(400)
        .json({ error: "An account with this email already exists" });
    }

    const passwordHash = await bcrypt.hash(adminPassword, 10);

    const company = await Company.create({
      name: companyName.trim(),
      status: "pending",
      requestedAdmin: {
        name: adminName.trim(),
        email: adminEmail.trim(),
        passwordHash,
        requestedAt: new Date(),
      },
    });

    return res.json({
      message: "Registration submitted. Awaiting superadmin approval.",
      companyId: company._id,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to submit registration" });
  }
});

// Create company with an admin employee
router.post("/", auth, async (req, res) => {
  if (req.employee.primaryRole !== "SUPERADMIN")
    return res.status(403).json({ error: "Forbidden" });
  const { companyName, adminName, adminEmail, adminPassword } = req.body;
  if (!companyName || !adminName || !adminEmail || !adminPassword) {
    return res.status(400).json({ error: "Missing fields" });
  }
  let admin = await Employee.findOne({ email: adminEmail });
  if (admin) return res.status(400).json({ error: "Admin already exists" });
  const passwordHash = await bcrypt.hash(adminPassword, 10);
  const companyId = new mongoose.Types.ObjectId();

  admin = await Employee.create({
    name: adminName,
    email: adminEmail,
    passwordHash,
    primaryRole: "ADMIN",
    subRoles: [],
    company: companyId,
  });

  // Create the company using the same id and point it to the admin
  const company = await Company.create({
    _id: companyId,
    name: companyName,
    admin: admin._id,
  });

  res.json({ company });
});

// List companies with admins
router.get("/", auth, async (req, res) => {
  if (req.employee.primaryRole !== "SUPERADMIN")
    return res.status(403).json({ error: "Forbidden" });
  const docs = await Company.find().populate("admin", "name email");
  // Hide sensitive requestedAdmin.passwordHash from API response
  const companies = docs.map((c) => {
    const obj = c.toObject({ virtuals: false });
    if (obj.requestedAdmin) delete obj.requestedAdmin.passwordHash;
    return obj;
  });
  res.json({ companies });
});

// Assign an admin to an existing company
router.post("/:companyId/admin", auth, async (req, res) => {
  if (req.employee.primaryRole !== "SUPERADMIN")
    return res.status(403).json({ error: "Forbidden" });
  const { adminName, adminEmail, adminPassword } = req.body;
  if (!adminName || !adminEmail || !adminPassword) {
    return res.status(400).json({ error: "Missing fields" });
  }
  const company = await Company.findById(req.params.companyId);
  if (!company) return res.status(404).json({ error: "Company not found" });
  if (company.admin)
    return res.status(400).json({ error: "Company already has an admin" });
  let existing = await Employee.findOne({ email: adminEmail });
  if (existing) return res.status(400).json({ error: "Admin already exists" });
  const passwordHash = await bcrypt.hash(adminPassword, 10);
  const admin = await Employee.create({
    name: adminName,
    email: adminEmail,
    passwordHash,
    primaryRole: "ADMIN",
    subRoles: [],
    company: company._id,
  });
  company.admin = admin._id;
  await company.save();
  const populated = await company.populate("admin", "name email");
  res.json({ company: populated });
});

// Superadmin: approve a pending company registration
router.post("/:companyId/approve", auth, async (req, res) => {
  if (req.employee.primaryRole !== "SUPERADMIN")
    return res.status(403).json({ error: "Forbidden" });
  const company = await Company.findById(req.params.companyId);
  if (!company) return res.status(404).json({ error: "Company not found" });
  if (company.status !== "pending")
    return res.status(400).json({ error: "Company is not pending" });
  if (!company.requestedAdmin || !company.requestedAdmin.email)
    return res.status(400).json({ error: "No requested admin details found" });

  let existing = await Employee.findOne({ email: company.requestedAdmin.email });
  if (existing)
    return res
      .status(400)
      .json({ error: "Admin email already exists. Cannot approve." });

  const admin = await Employee.create({
    name: company.requestedAdmin.name,
    email: company.requestedAdmin.email,
    passwordHash: company.requestedAdmin.passwordHash,
    primaryRole: "ADMIN",
    subRoles: [],
    company: company._id,
  });

  company.admin = admin._id;
  company.status = "approved";
  company.requestedAdmin = undefined;
  await company.save();

  const populated = await company.populate("admin", "name email");
  res.json({ company: populated });
});

// Superadmin: reject a pending company registration
router.post("/:companyId/reject", auth, async (req, res) => {
  if (req.employee.primaryRole !== "SUPERADMIN")
    return res.status(403).json({ error: "Forbidden" });
  const company = await Company.findById(req.params.companyId);
  if (!company) return res.status(404).json({ error: "Company not found" });
  if (company.status !== "pending")
    return res.status(400).json({ error: "Company is not pending" });
  company.status = "rejected";
  await company.save();
  res.json({ company });
});

// Admin: list roles in their company
router.get("/roles", auth, async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });
  const company = await Company.findOne({ admin: req.employee.id }).select("roles");
  if (!company) return res.status(400).json({ error: "Company not found" });
  res.json({ roles: company.roles || [] });
});

// Admin: add a role to their company
router.post("/roles", auth, async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });
  const { role } = req.body;
  if (!role) return res.status(400).json({ error: "Missing role" });
  const company = await Company.findOne({ admin: req.employee.id });
  if (!company) return res.status(400).json({ error: "Company not found" });
  if (!company.roles.includes(role)) company.roles.push(role);
  await company.save();
  res.json({ roles: company.roles });
});

// Admin: update a role in their company
router.put("/roles/:role", auth, async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });

  const { role } = req.params;
  const { newRole } = req.body;
  if (!newRole) return res.status(400).json({ error: "Missing role" });

  const company = await Company.findOne({ admin: req.employee.id });
  if (!company) return res.status(400).json({ error: "Company not found" });

  const idx = company.roles.indexOf(role);
  if (idx === -1) return res.status(404).json({ error: "Role not found" });
  if (company.roles.includes(newRole))
    return res.status(400).json({ error: "Role already exists" });

  company.roles[idx] = newRole;
  await company.save();

  await Employee.updateMany(
    { company: company._id, subRoles: role },
    { $set: { "subRoles.$": newRole } }
  );

  res.json({ roles: company.roles });
});

// Admin: create employee in their company
router.post("/employees", auth, upload.array("documents"), async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });
  const {
    name,
    email,
    password,
    role,
    address,
    phone,
    dob,
    reportingPerson,
    employeeId,
    ctc,
  } = req.body;
  if (!name || !email || !password || !role || !employeeId)
    return res.status(400).json({ error: "Missing fields" });
  const company = await Company.findOne({ admin: req.employee.id });
  if (!company) return res.status(400).json({ error: "Company not found" });
  if (!company.roles.includes(role))
    return res.status(400).json({ error: "Invalid role" });
  let existing = await Employee.findOne({ $or: [{ email }, { employeeId }] });
  if (existing)
    return res.status(400).json({ error: "Employee already exists" });
  const passwordHash = await bcrypt.hash(password, 10);
  const documents = (req.files || []).map((f) => f.filename);
  let reporting = null;
  if (reportingPerson) {
    reporting = await Employee.findById(reportingPerson);
    if (!reporting || !reporting.company.equals(company._id))
      return res.status(400).json({ error: "Reporting person not found" });
  }
  const leaveBalances = {
    casual: company.leavePolicy?.casual || 0,
    paid: company.leavePolicy?.paid || 0,
    unpaid: 0,
    sick: company.leavePolicy?.sick || 0,
  };
  const employee = await Employee.create({
    name,
    email,
    passwordHash,
    primaryRole: "EMPLOYEE",
    subRoles: [role],
    company: company._id,
    address,
    phone,
    dob: dob ? new Date(dob) : undefined,
    employeeId,
    ctc: Number.isFinite(Number(ctc)) ? Number(ctc) : 0,
    documents,
    reportingPerson: reporting ? reporting._id : undefined,
    leaveBalances,
  });
  res.json({
    employee: {
      id: employee._id,
      name: employee.name,
      email: employee.email,
      subRoles: employee.subRoles,
    },
  });
});

// Admin: get leave policy for their company
router.get("/leave-policy", auth, async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });
  const company = await Company.findOne({ admin: req.employee.id }).select(
    "leavePolicy"
  );
  if (!company) return res.status(400).json({ error: "Company not found" });
  const lp = company.leavePolicy || {};
  res.json({
    leavePolicy: {
      totalAnnual: lp.totalAnnual || 0,
      ratePerMonth: lp.ratePerMonth || 0,
      typeCaps: {
        paid: lp.typeCaps?.paid || 0,
        casual: lp.typeCaps?.casual || 0,
        sick: lp.typeCaps?.sick || 0,
      },
    },
  });
});

// Admin: get work hours (company timing)
router.get("/work-hours", auth, async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });
  const company = await Company.findOne({ admin: req.employee.id }).select(
    "workHours"
  );
  if (!company) return res.status(400).json({ error: "Company not found" });
  const wh = company.workHours || { start: "", end: "", graceMinutes: 0 };
  res.json({ workHours: { start: wh.start || "", end: wh.end || "", graceMinutes: wh.graceMinutes || 0 } });
});

// Admin: update work hours (company timing)
router.put("/work-hours", auth, async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });
  const { start, end, graceMinutes } = req.body || {};
  // Basic validation: HH:mm format for times, non-negative grace
  function isHHmm(s) {
    return typeof s === 'string' && /^\d{2}:\d{2}$/.test(s);
  }
  if (!isHHmm(start) || !isHHmm(end))
    return res.status(400).json({ error: "Invalid time format. Use HH:mm" });
  const [sh, sm] = start.split(":").map((x) => parseInt(x, 10));
  const [eh, em] = end.split(":").map((x) => parseInt(x, 10));
  if (sh < 0 || sh > 23 || sm < 0 || sm > 59 || eh < 0 || eh > 23 || em < 0 || em > 59)
    return res.status(400).json({ error: "Invalid time values" });
  const gm = parseInt(graceMinutes, 10);
  if (!Number.isFinite(gm) || gm < 0)
    return res.status(400).json({ error: "Invalid grace minutes" });

  const company = await Company.findOne({ admin: req.employee.id });
  if (!company) return res.status(400).json({ error: "Company not found" });
  company.workHours = { start, end, graceMinutes: gm };
  await company.save();
  res.json({ workHours: company.workHours });
});

// Admin: update leave policy for their company
router.put("/leave-policy", auth, async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });
  const { totalAnnual, ratePerMonth, typeCaps } = req.body || {};
  const company = await Company.findOne({ admin: req.employee.id });
  if (!company) return res.status(400).json({ error: "Company not found" });
  const total = Number(totalAnnual) || 0;
  const rpm = Number(ratePerMonth) || 0;
  const caps = {
    paid: Number(typeCaps?.paid) || 0,
    casual: Number(typeCaps?.casual) || 0,
    sick: Number(typeCaps?.sick) || 0,
  };
  if (total < 0 || rpm < 0) return res.status(400).json({ error: "Invalid totals" });
  const sumCaps = caps.paid + caps.casual + caps.sick;
  if (sumCaps > total) return res.status(400).json({ error: "Type caps cannot exceed total annual leaves" });
  company.leavePolicy = {
    totalAnnual: total,
    ratePerMonth: rpm,
    typeCaps: caps,
  };
  await company.save();
  res.json({ leavePolicy: company.leavePolicy });
});

// Admin: list bank holidays
router.get("/bank-holidays", auth, async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });
  const company = await Company.findOne({ admin: req.employee.id }).select(
    "bankHolidays"
  );
  if (!company) return res.status(400).json({ error: "Company not found" });
  res.json({ bankHolidays: company.bankHolidays || [] });
});

// Admin: add a bank holiday
router.post("/bank-holidays", auth, async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });
  const { date, name } = req.body;
  if (!date) return res.status(400).json({ error: "Missing date" });
  const company = await Company.findOne({ admin: req.employee.id });
  if (!company) return res.status(400).json({ error: "Company not found" });
  const existing = company.bankHolidays?.some(
    (h) => h.date.toISOString().slice(0, 10) === new Date(date).toISOString().slice(0, 10)
  );
  if (!existing) {
    company.bankHolidays.push({ date, name });
    await company.save();
  }
  res.json({ bankHolidays: company.bankHolidays });
});

// Admin: list company day overrides for a month (or all upcoming)
// GET /companies/day-overrides?month=yyyy-mm
router.get("/day-overrides", auth, async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });
  const company = await Company.findOne({ admin: req.employee.id }).select("_id");
  if (!company) return res.status(400).json({ error: "Company not found" });

  const { month } = req.query || {};
  let filter = { company: company._id };
  if (month) {
    const start = startOfDay(new Date(month + "-01"));
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);
    filter = { ...filter, date: { $gte: start, $lt: end } };
  }

  const overrides = await CompanyDayOverride.find(filter).sort({ date: 1 }).lean();
  res.json({ overrides: overrides.map(o => ({
    date: new Date(o.date).toISOString().slice(0,10),
    type: o.type,
    note: o.note || "",
  })) });
});

// Admin: upsert a company day override
// Body: { date: 'yyyy-mm-dd', type: 'WORKING'|'HOLIDAY'|'HALF_DAY', note? }
router.post("/day-overrides", auth, async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });
  const { date, type, note } = req.body || {};
  if (!date || !type) return res.status(400).json({ error: "Missing date or type" });
  if (!['WORKING','HOLIDAY','HALF_DAY'].includes(type))
    return res.status(400).json({ error: "Invalid type" });

  const company = await Company.findOne({ admin: req.employee.id }).select("_id");
  if (!company) return res.status(400).json({ error: "Company not found" });

  const day = startOfDay(new Date(date));
  if (isNaN(day.getTime())) return res.status(400).json({ error: "Invalid date" });

  await CompanyDayOverride.findOneAndUpdate(
    { company: company._id, date: day },
    { $setOnInsert: { company: company._id, date: day }, $set: { type, note: note || "", updatedBy: req.employee.id } },
    { upsert: true }
  );

  const month = `${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,'0')}`;
  const start = startOfDay(new Date(month + "-01"));
  const end = new Date(start); end.setMonth(end.getMonth()+1);
  const overrides = await CompanyDayOverride.find({ company: company._id, date: { $gte: start, $lt: end } }).sort({ date: 1 }).lean();
  res.json({ overrides: overrides.map(o => ({ date: new Date(o.date).toISOString().slice(0,10), type: o.type, note: o.note || "" })) });
});

// Admin: delete a company day override by date
router.delete("/day-overrides/:date", auth, async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });
  const { date } = req.params;
  const company = await Company.findOne({ admin: req.employee.id }).select("_id");
  if (!company) return res.status(400).json({ error: "Company not found" });
  const day = startOfDay(new Date(date));
  if (isNaN(day.getTime())) return res.status(400).json({ error: "Invalid date" });
  await CompanyDayOverride.deleteOne({ company: company._id, date: day });
  res.json({ ok: true });
});

// Admin: reset leave balances for all employees in the company
// Body: { reaccrue?: boolean } (default true)
router.post("/leave-balances/reset", auth, async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });
  const { reaccrue } = req.body || {};
  const company = await Company.findOne({ admin: req.employee.id }).select("_id leavePolicy");
  if (!company) return res.status(400).json({ error: "Company not found" });
  const emps = await Employee.find({ company: company._id });
  let count = 0;
  for (const e of emps) {
    try {
      e.totalLeaveAvailable = 0;
      e.leaveUsage = { paid: 0, casual: 0, sick: 0, unpaid: 0 };
      e.leaveBalances = { paid: 0, casual: 0, sick: 0, unpaid: 0 };
      e.leaveAccrual = {}; // clear lastAccruedYearMonth so accrual can recompute
      await e.save();
      if (reaccrue !== false) {
        await syncLeaveBalances(e);
      }
      count++;
    } catch (err) {
      console.warn('[leave-reset] failed for employee', String(e._id), err?.message || err);
    }
  }
  res.json({ ok: true, count });
});

// Admin: update reporting person of an employee
router.put("/employees/:id/reporting", auth, async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });
  const { reportingPerson } = req.body;
  const company = await Company.findOne({ admin: req.employee.id });
  if (!company) return res.status(400).json({ error: "Company not found" });
  const employee = await Employee.findById(req.params.id);
  if (!employee || !employee.company.equals(company._id))
    return res.status(404).json({ error: "Employee not found" });

  if (reportingPerson) {
    const reporting = await Employee.findById(reportingPerson);
    if (!reporting || !reporting.company.equals(company._id))
      return res.status(400).json({ error: "Reporting person not found" });
    employee.reportingPerson = reporting._id;
  } else {
    employee.reportingPerson = undefined;
  }

  await employee.save();
  res.json({
    employee: {
      id: employee._id,
      reportingPerson: employee.reportingPerson || null,
    },
  });
});

// Admin: update role of an employee
router.put("/employees/:id/role", auth, async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });
  const { role } = req.body;
  if (!role) return res.status(400).json({ error: "Invalid role" });
  const company = await Company.findOne({ admin: req.employee.id });
  if (!company) return res.status(400).json({ error: "Company not found" });
  if (!company.roles.includes(role))
    return res.status(400).json({ error: "Invalid role" });
  const employee = await Employee.findById(req.params.id);
  if (!employee || !employee.company.equals(company._id))
    return res.status(404).json({ error: "Employee not found" });

  employee.subRoles = [role];
  await employee.save();
  res.json({
    employee: { id: employee._id, subRoles: employee.subRoles },
  });
});

// Admin: update general details for an employee (CTC, contact, IDs, bank)
router.put("/employees/:id", auth, async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });

  const {
    address,
    phone,
    dob,
    ctc,
    aadharNumber,
    panNumber,
    bankDetails,
  } = req.body || {};

  // Only admins of the company can update within that company
  const company = await Company.findOne({ admin: req.employee.id });
  if (!company) return res.status(400).json({ error: "Company not found" });

  const employee = await Employee.findById(req.params.id);
  if (!employee || !employee.company.equals(company._id))
    return res.status(404).json({ error: "Employee not found" });

  // Validate and assign fields
  if (typeof address === 'string') employee.address = address.trim();
  if (typeof phone === 'string') employee.phone = phone.trim();
  if (dob) {
    const d = new Date(dob);
    if (isNaN(d.getTime())) return res.status(400).json({ error: 'Invalid DOB' });
    employee.dob = d;
  }
  if (ctc !== undefined) {
    const n = Number(ctc);
    if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: 'Invalid CTC' });
    employee.ctc = n;
  }
  if (typeof aadharNumber === 'string') employee.aadharNumber = aadharNumber.trim();
  if (typeof panNumber === 'string') employee.panNumber = panNumber.trim();
  if (bankDetails && typeof bankDetails === 'object') {
    employee.bankDetails = employee.bankDetails || {};
    if (typeof bankDetails.accountNumber === 'string') employee.bankDetails.accountNumber = bankDetails.accountNumber.trim();
    if (typeof bankDetails.bankName === 'string') employee.bankDetails.bankName = bankDetails.bankName.trim();
    if (typeof bankDetails.ifsc === 'string') employee.bankDetails.ifsc = bankDetails.ifsc.trim();
  }

  await employee.save();
  try { employee.decryptFieldsSync(); } catch (_) {}
  res.json({
    employee: {
      id: employee._id,
      address: employee.address || '',
      phone: employee.phone || '',
      dob: employee.dob,
      ctc: employee.ctc || 0,
      aadharNumber: employee.aadharNumber || '',
      panNumber: employee.panNumber || '',
      bankDetails: {
        accountNumber: employee.bankDetails?.accountNumber || '',
        bankName: employee.bankDetails?.bankName || '',
        ifsc: employee.bankDetails?.ifsc || '',
      },
    },
  });
});

// Admin: delete an employee (with safety checks)
router.delete("/employees/:id", auth, async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });

  const company = await Company.findOne({ admin: req.employee.id });
  if (!company) return res.status(400).json({ error: "Company not found" });

  const employee = await Employee.findById(req.params.id);
  if (!employee || !employee.company.equals(company._id))
    return res.status(404).json({ error: "Employee not found" });

  // Prevent deleting admins or yourself
  if (["ADMIN", "SUPERADMIN"].includes(employee.primaryRole))
    return res.status(400).json({ error: "Cannot delete an admin account" });
  if (String(employee._id) === String(req.employee.id))
    return res.status(400).json({ error: "You cannot delete your own account" });

  // Safety checks for project/team lead
  const leads = await Project.countDocuments({ teamLead: employee._id });
  if (leads > 0)
    return res.status(400).json({ error: "Employee is a team lead on projects. Reassign before deleting." });

  // Safety checks for dependent records that can't be safely reassigned here
  const hasTasks = await Task.exists({ $or: [{ assignedTo: employee._id }, { createdBy: employee._id }] });
  if (hasTasks)
    return res.status(400).json({ error: "Employee has tasks. Reassign or remove tasks before deleting." });

  const hasSlips = await SalarySlip.exists({ employee: employee._id });
  if (hasSlips)
    return res.status(400).json({ error: "Employee has salary slips. Delete slips before deleting employee." });

  // Remove from project memberships
  await Project.updateMany({ members: employee._id }, { $pull: { members: employee._id } });

  // Clear as reportingPerson for others within company
  await Employee.updateMany(
    { company: company._id, reportingPerson: employee._id },
    { $unset: { reportingPerson: "" } }
  );

  await Employee.deleteOne({ _id: employee._id });
  res.json({ ok: true });
});

// Admin: list employees in their company
router.get("/employees", auth, async (req, res) => {
  const allowed =
    ["ADMIN", "SUPERADMIN", "EMPLOYEE"].includes(req.employee.primaryRole) ||
    (req.employee.subRoles || []).some((r) => ["hr", "manager"].includes(r));
  if (!allowed) return res.status(403).json({ error: "Forbidden" });

  let companyId;
  if (["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole)) {
    const company = await Company.findOne({ admin: req.employee.id });
    if (!company) return res.status(400).json({ error: "Company not found" });
    companyId = company._id;
  } else {
    companyId = req.employee.company;
  }

  const employees = await Employee.find({ company: companyId })
    .select("name email subRoles")
    .lean();
  res.json({
    employees: employees.map((u) => ({
      id: u._id,
      name: u.name,
      email: u.email,
      subRoles: u.subRoles,
    })),
  });
});

module.exports = router;
