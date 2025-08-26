const router = require("express").Router();
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const { auth } = require("../middleware/auth");
const Company = require("../models/Company");
const Employee = require("../models/Employee");
const multer = require("multer");
const path = require("path");
const upload = multer({ dest: path.join(__dirname, "../../uploads") });

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
  const companies = await Company.find().populate("admin", "name email");
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
    reportingPerson,
  } = req.body;
  if (!name || !email || !password || !role)
    return res.status(400).json({ error: "Missing fields" });
  const company = await Company.findOne({ admin: req.employee.id });
  if (!company) return res.status(400).json({ error: "Company not found" });
  let existing = await Employee.findOne({ email });
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
  res.json({
    leavePolicy: {
      casual: company.leavePolicy?.casual || 0,
      paid: company.leavePolicy?.paid || 0,
      sick: company.leavePolicy?.sick || 0,
    },
  });
});

// Admin: update leave policy for their company
router.put("/leave-policy", auth, async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });
  const { casual, paid, sick } = req.body;
  const company = await Company.findOne({ admin: req.employee.id });
  if (!company) return res.status(400).json({ error: "Company not found" });
  company.leavePolicy = {
    casual: parseInt(casual, 10) || 0,
    paid: parseInt(paid, 10) || 0,
    sick: parseInt(sick, 10) || 0,
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

// Admin: list employees in their company
router.get("/employees", auth, async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });
  const company = await Company.findOne({ admin: req.employee.id });
  if (!company) return res.status(400).json({ error: "Company not found" });
  const employees = await Employee.find({ company: company._id })
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
