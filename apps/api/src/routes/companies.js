const router = require("express").Router();
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const { auth } = require("../middleware/auth");
const Company = require("../models/Company");
const Employee = require("../models/Employee");
const multer = require("multer");
const path = require("path");
const upload = multer({ dest: path.join(__dirname, "../../uploads") });

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
