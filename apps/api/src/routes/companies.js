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
const MasterCountry = require("../models/MasterCountry");
const MasterState = require("../models/MasterState");
const MasterCity = require("../models/MasterCity");
const CompanyTypeMaster = require("../models/CompanyTypeMaster");
const { upload } = require("../utils/uploads");
const { syncLeaveBalances, accrueTotalIfNeeded } = require("../utils/leaveBalances");
const { sendMail, isEmailEnabled, invalidateCompanyTransporter } = require("../utils/mailer");
const { isValidEmail, isValidPassword, isValidPhone, normalizePhone } = require("../utils/validate");

// Utility: simple hex validation
function isHexColor(v) {
  return typeof v === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v.trim());
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function parseApplicableMonth(value) {
  if (!value) return undefined;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const match = trimmed.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
    if (!match) return undefined;
    const year = Number(match[1]);
    const monthIdx = Number(match[2]) - 1;
    return new Date(Date.UTC(year, monthIdx, 1));
  }
  return undefined;
}

function formatApplicableMonth(date) {
  if (!date) return "";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function normalizeReportingIds(value) {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => normalizeReportingIds(item))
      .map((id) => String(id).trim())
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return normalizeReportingIds(parsed);
        }
      } catch (_) {
        // fall back to comma split below
      }
    }
    if (trimmed.includes(',')) {
      return trimmed
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
    }
    return [trimmed];
  }
  return [String(value).trim()].filter(Boolean);
}

async function resolveReportingEmployees(companyId, value) {
  const normalized = normalizeReportingIds(value);
  const orderedUnique = Array.from(new Set(normalized));
  if (!orderedUnique.length) return [];
  const invalid = orderedUnique.find(
    (id) => !mongoose.Types.ObjectId.isValid(String(id))
  );
  if (invalid) {
    const err = new Error('Reporting person not found');
    err.statusCode = 400;
    throw err;
  }
  const matches = await Employee.find({
    _id: { $in: orderedUnique },
    company: companyId,
  });
  if (matches.length !== orderedUnique.length) {
    const err = new Error('Reporting person not found');
    err.statusCode = 400;
    throw err;
  }
  const map = new Map(matches.map((doc) => [String(doc._id), doc]));
  return orderedUnique.map((id) => map.get(String(id))).filter(Boolean);
}

function formatReportingResponse(reportingDocs = []) {
  return reportingDocs.map((doc) => ({
    id: doc._id,
    name: doc.name,
  }));
}

function parseBooleanInput(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  }
  return fallback;
}

const BLOOD_GROUPS = new Set(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]);

function normalizeBloodGroup(v) {
  if (typeof v !== "string") return undefined;
  const upper = v.trim().toUpperCase();
  if (!upper) return undefined;
  return BLOOD_GROUPS.has(upper) ? upper : undefined;
}

function scheduleApprovalEmail(companyOrName, email, passwordPlain) {
  if (!email) return;
  const companyId = companyOrName && companyOrName._id ? companyOrName._id : null;
  const companyName =
    (companyOrName && companyOrName.name) ||
    (typeof companyOrName === 'string' ? companyOrName : 'Company');
  const loginLink = process.env.CLIENT_ORIGIN
    ? `${process.env.CLIENT_ORIGIN}/login`
    : null;
  const subject = `Your company has been approved: ${companyName}`;
  const credentialLines = [`Email: ${email}`];
  if (passwordPlain) {
    credentialLines.push(`Password: ${passwordPlain}`);
  } else {
    credentialLines.push(
      "Password: (use the password you set during registration or reset it from the login page)"
    );
  }
  const credentialsText = credentialLines.join('\n');
  const text = `Good news! Your company "${companyName}" has been approved. You can now log in.${
    loginLink ? `\n\nLogin: ${loginLink}` : ''
  }\n\n${credentialsText}`;
  const htmlLogin = loginLink
    ? `<p><a href="${loginLink}">Log in</a> to get started.</p>`
    : '';
  const htmlCredentials = `<p><strong>Administrator credentials</strong><br>Email: ${email}${
    passwordPlain
      ? `<br>Password: ${passwordPlain}`
      : '<br>Password: Use the password you set during registration or reset it from the login page.'
  }</p>`;
  (async () => {
    try {
      if (!(await isEmailEnabled(companyId))) return;
      await sendMail({
        companyId,
        to: email,
        subject,
        text,
        html: `<p>Good news! Your company <strong>${companyName}</strong> has been approved.</p>${htmlLogin}${htmlCredentials}<p style="color:#666;font-size:12px;">Automated email from HRMS</p>`,
      });
    } catch (err) {
      console.warn('[companies] failed to send approval email:', err?.message || err);
    }
  })();
}

function scheduleRejectionEmail(companyOrName, email) {
  if (!email) return;
  const companyId = companyOrName && companyOrName._id ? companyOrName._id : null;
  const companyName =
    (companyOrName && companyOrName.name) ||
    (typeof companyOrName === 'string' ? companyOrName : 'Company');
  const subject = `Your company registration was rejected: ${companyName}`;
  const text = `We’re sorry, but your company "${companyName}" was not approved at this time.`;
  const html = `<p>We’re sorry, but your company <strong>${companyName}</strong> was not approved at this time.</p><p>If you believe this is an error, please contact support.</p>`;
  (async () => {
    try {
      if (!(await isEmailEnabled(companyId))) return;
      await sendMail({ companyId, to: email, subject, text, html });
    } catch (err) {
      console.warn('[companies] failed to send rejection email:', err?.message || err);
    }
  })();
}

function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

async function resolveLocationAndType({
  countryId,
  stateId,
  cityId,
  companyTypeId,
}) {
  const ids = [countryId, stateId, cityId, companyTypeId];
  if (ids.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
    throw httpError(400, "Invalid reference provided");
  }

  const [country, state, city, companyType] = await Promise.all([
    MasterCountry.findById(countryId),
    MasterState.findById(stateId),
    MasterCity.findById(cityId),
    CompanyTypeMaster.findById(companyTypeId),
  ]);

  if (!country) throw httpError(400, "Selected country not found");
  if (!state || !state.country.equals(country._id)) {
    throw httpError(
      400,
      "Selected state is not valid for the chosen country"
    );
  }
  if (!city || !city.state.equals(state._id) || !city.country.equals(country._id)) {
    throw httpError(
      400,
      "Selected city is not valid for the chosen state"
    );
  }
  if (!companyType) throw httpError(400, "Selected company type not found");

  return { country, state, city, companyType };
}

async function approvePendingCompany(company) {
  if (company.status !== "pending") {
    throw httpError(400, "Company is not pending");
  }
  if (!company.requestedAdmin || !company.requestedAdmin.email) {
    throw httpError(400, "No requested admin details found");
  }

  const pendingAdmin = { ...company.requestedAdmin };
  const existing = await Employee.findOne({ email: pendingAdmin.email });
  if (existing) {
    throw httpError(400, "Admin email already exists. Cannot approve.");
  }

  const admin = await Employee.create({
    name: pendingAdmin.name,
    email: pendingAdmin.email,
    passwordHash: pendingAdmin.passwordHash,
    primaryRole: "ADMIN",
    subRoles: [],
    company: company._id,
  });

  company.admin = admin._id;
  company.status = "approved";
  company.requestedAdmin = undefined;
  await company.save();

  const populated = await company.populate("admin", "name email");
  scheduleApprovalEmail(company, pendingAdmin.email, pendingAdmin.passwordPlain);
  return populated;
}

async function rejectPendingCompany(company) {
  if (company.status !== "pending") {
    throw httpError(400, "Company is not pending");
  }
  const pendingAdmin = company.requestedAdmin ? { ...company.requestedAdmin } : null;
  company.status = "rejected";
  if (company.requestedAdmin) {
    company.requestedAdmin.passwordPlain = undefined;
  }
  await company.save();
  const populated = await company.populate("admin", "name email");
  if (pendingAdmin?.email) {
    scheduleRejectionEmail(company, pendingAdmin.email);
  }
  return populated;
}

async function rejectApprovedCompany(company) {
  if (company.status !== "approved") {
    throw httpError(400, "Company is not approved");
  }
  company.status = "rejected";
  await company.save();
  const populated = await company.populate("admin", "name email");
  const notify = populated.admin?.email || company.requestedAdmin?.email;
  if (notify) scheduleRejectionEmail(company, notify);
  return populated;
}

async function transitionCompanyStatus(company, nextStatus) {
  if (nextStatus === company.status) {
    return company.populate("admin", "name email");
  }

  if (nextStatus === "approved") {
    if (company.status === "pending") {
      return approvePendingCompany(company);
    }
    if (company.status === "rejected") {
      if (company.requestedAdmin && company.requestedAdmin.email) {
        return approvePendingCompany(company);
      }
      if (company.admin) {
        company.status = "approved";
        await company.save();
        return company.populate("admin", "name email");
      }
      throw httpError(
        400,
        "Missing pending admin details. Ask the company to register again."
      );
    }
    return company.populate("admin", "name email");
  }

  if (nextStatus === "rejected") {
    if (company.status === "pending") {
      return rejectPendingCompany(company);
    }
    if (company.status === "approved") {
      return rejectApprovedCompany(company);
    }
    return company.populate("admin", "name email");
  }

  throw httpError(400, "Unsupported status change");
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

// Admin: get SMTP configuration
router.get("/smtp", auth, async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });

  const company = await Company.findOne({ admin: req.employee.id }).select('smtp');
  if (!company) return res.status(400).json({ error: "Company not found" });
  const smtp = company.smtp || {};
  res.json({
    smtp: {
      enabled: !!smtp.enabled,
      host: smtp.host || '',
      port: typeof smtp.port === 'number' ? smtp.port : 587,
      secure: !!smtp.secure,
      user: smtp.user || '',
      from: smtp.from || '',
      replyTo: smtp.replyTo || '',
      passwordSet: !!smtp.pass,
    },
  });
});

// Admin: update SMTP configuration
router.put("/smtp", auth, async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });

  const company = await Company.findOne({ admin: req.employee.id }).select('smtp');
  if (!company) return res.status(400).json({ error: "Company not found" });

  const body = req.body || {};
  const enabled = parseBooleanInput(body.enabled, false);

  if (!enabled) {
    company.smtp = { enabled: false };
    await company.save();
    invalidateCompanyTransporter(company._id);
    return res.json({
      smtp: {
        enabled: false,
        host: '',
        port: 587,
        secure: false,
        user: '',
        from: '',
        replyTo: '',
        passwordSet: false,
      },
    });
  }

  const host = typeof body.host === 'string' ? body.host.trim() : '';
  if (!host) return res.status(400).json({ error: 'SMTP host is required' });

  const portRaw = body.port !== undefined ? body.port : 587;
  const portNum = parseInt(portRaw, 10);
  if (!Number.isFinite(portNum) || portNum <= 0 || portNum > 65535) {
    return res.status(400).json({ error: 'SMTP port must be between 1 and 65535' });
  }

  const secure = parseBooleanInput(body.secure, portNum === 465);
  const user = typeof body.user === 'string' ? body.user.trim() : '';
  const from = typeof body.from === 'string' ? body.from.trim() : '';
  const replyTo = typeof body.replyTo === 'string' ? body.replyTo.trim() : '';

  let nextPass = (company.smtp && company.smtp.pass) || undefined;
  if (Object.prototype.hasOwnProperty.call(body, 'password')) {
    const raw = body.password;
    if (raw === null || (typeof raw === 'string' && raw.trim() === '')) {
      nextPass = undefined;
    } else if (typeof raw === 'string') {
      nextPass = raw;
    } else {
      return res.status(400).json({ error: 'Invalid password value' });
    }
  }

  company.smtp = {
    enabled: true,
    host,
    port: portNum,
    secure,
    user: user || undefined,
    from: from || undefined,
    replyTo: replyTo || undefined,
    pass: nextPass,
  };
  await company.save();
  invalidateCompanyTransporter(company._id);

  res.json({
    smtp: {
      enabled: true,
      host,
      port: portNum,
      secure,
      user: user || '',
      from: from || '',
      replyTo: replyTo || '',
      passwordSet: !!nextPass,
    },
  });
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
    const {
      companyName,
      adminName,
      adminEmail,
      adminPassword,
      countryId,
      stateId,
      cityId,
      companyTypeId,
      leaveApplicableFrom,
    } = req.body || {};
    if (
      !companyName ||
      !adminName ||
      !adminEmail ||
      !adminPassword ||
      !countryId ||
      !stateId ||
      !cityId ||
      !companyTypeId
    ) {
      return res.status(400).json({ error: "Missing fields" });
    }
    if (!isValidEmail(adminEmail)) {
      return res.status(400).json({ error: "Invalid admin email" });
    }
    if (!isValidPassword(adminPassword)) {
      return res.status(400).json({ error: "Password must be more than 5 characters" });
    }

    let country, state, city, companyType;
    try {
      ({ country, state, city, companyType } = await resolveLocationAndType({
        countryId,
        stateId,
        cityId,
        companyTypeId,
      }));
    } catch (err) {
      const statusCode = err.statusCode || 500;
      if (statusCode >= 500) console.error('[companies/register]', err);
      return res
        .status(statusCode)
        .json({ error: err.message || 'Invalid master selections' });
    }

    const existingAdmin = await Employee.findOne({ email: adminEmail });
    if (existingAdmin) {
      return res
        .status(400)
        .json({ error: "An account with this email already exists" });
    }

    const passwordHash = await bcrypt.hash(adminPassword, 10);

    const applicableFromDate = parseApplicableMonth(leaveApplicableFrom);
    if (leaveApplicableFrom && !applicableFromDate) {
      return res.status(400).json({ error: "Invalid leave applicable date" });
    }

    const company = await Company.create({
      name: companyName.trim(),
      status: "pending",
      requestedAdmin: {
        name: adminName.trim(),
        email: adminEmail.trim(),
        passwordHash,
        passwordPlain: adminPassword,
        requestedAt: new Date(),
      },
      location: {
        country: country._id,
        countryName: country.name,
        state: state._id,
        stateName: state.name,
        city: city._id,
        cityName: city.name,
      },
      companyType: companyType._id,
      companyTypeName: companyType.name,
      leavePolicy: applicableFromDate
        ? {
            applicableFrom: applicableFromDate,
            totalAnnual: 0,
            ratePerMonth: 0,
            typeCaps: { paid: 0, casual: 0, sick: 0 },
          }
        : undefined,
    });

    // Async notifications (non-blocking)
    ;(async () => {
      try {
        if (await isEmailEnabled()) {
          // Notify platform superadmins
          const supers = await Employee.find({ primaryRole: 'SUPERADMIN' }).select('email name');
          const to = (supers || []).map((u) => u.email).filter(Boolean);
          if (to.length) {
            const subject = `New company registration pending: ${company.name}`;
            const text = `A new company has requested approval.\n\nCompany: ${company.name}\nAdmin: ${adminName} <${adminEmail}>\n\nReview in the dashboard.`;
            const link = process.env.CLIENT_ORIGIN ? `${process.env.CLIENT_ORIGIN}/superadmin/companies` : null;
            const html = `<p>A new company has requested approval.</p>
              <p><strong>Company:</strong> ${company.name}</p>
              <p><strong>Admin:</strong> ${adminName} &lt;${adminEmail}&gt;</p>
              ${link ? `<p><a href="${link}">Review in dashboard</a></p>` : ''}
              <p style="color:#666;font-size:12px;">Automated email from HRMS</p>`;
            await sendMail({ to, subject, text, html });
          }
          // Acknowledge requester
          const subject2 = `Registration received: ${company.name}`;
          const text2 = `Thanks for registering ${company.name}. Your request is pending approval. We will notify you once reviewed.`;
          const html2 = `<p>Thanks for registering <strong>${company.name}</strong>.</p><p>Your request is pending approval. We will notify you once reviewed.</p>`;
          await sendMail({ companyId: company._id, to: adminEmail.trim(), subject: subject2, text: text2, html: html2 });
        }
      } catch (e) {
        console.warn('[companies/register] failed to send email:', e?.message || e);
      }
    })();

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
  const {
    companyName,
    adminName,
    adminEmail,
    adminPassword,
    countryId,
    stateId,
    cityId,
    companyTypeId,
  } = req.body || {};
  if (
    !companyName ||
    !adminName ||
    !adminEmail ||
    !adminPassword ||
    !countryId ||
    !stateId ||
    !cityId ||
    !companyTypeId
  ) {
    return res.status(400).json({ error: "Missing fields" });
  }
  if (!isValidEmail(adminEmail)) {
    return res.status(400).json({ error: "Invalid admin email" });
  }
  if (!isValidPassword(adminPassword)) {
    return res.status(400).json({ error: "Password must be more than 5 characters" });
  }
  let admin = await Employee.findOne({ email: adminEmail });
  if (admin) return res.status(400).json({ error: "Admin already exists" });
  const passwordHash = await bcrypt.hash(adminPassword, 10);
  const companyId = new mongoose.Types.ObjectId();

  let country, state, city, companyType;
  try {
    ({ country, state, city, companyType } = await resolveLocationAndType({
      countryId,
      stateId,
      cityId,
      companyTypeId,
    }));
  } catch (err) {
    const statusCode = err.statusCode || 500;
    if (statusCode >= 500) console.error('[companies/create]', err);
    return res.status(statusCode).json({ error: err.message || 'Invalid master selections' });
  }

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
    status: "approved",
    location: {
      country: country._id,
      countryName: country.name,
      state: state._id,
      stateName: state.name,
      city: city._id,
      cityName: city.name,
    },
    companyType: companyType._id,
    companyTypeName: companyType.name,
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
    if (obj.requestedAdmin) {
      delete obj.requestedAdmin.passwordHash;
      delete obj.requestedAdmin.passwordPlain;
    }
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
  if (!isValidEmail(adminEmail)) {
    return res.status(400).json({ error: "Invalid admin email" });
  }
  if (!isValidPassword(adminPassword)) {
    return res.status(400).json({ error: "Password must be more than 5 characters" });
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
  try {
    const populated = await approvePendingCompany(company);
    return res.json({ company: populated });
  } catch (err) {
    const statusCode = err.statusCode || 500;
    if (statusCode >= 500) console.error('[companies/approve]', err);
    return res.status(statusCode).json({ error: err.message || 'Failed to approve company' });
  }
});

// Superadmin: reject a pending company registration
router.post("/:companyId/reject", auth, async (req, res) => {
  if (req.employee.primaryRole !== "SUPERADMIN")
    return res.status(403).json({ error: "Forbidden" });
  const company = await Company.findById(req.params.companyId);
  if (!company) return res.status(404).json({ error: "Company not found" });
  try {
    const populated = await rejectPendingCompany(company);
    return res.json({ company: populated });
  } catch (err) {
    const statusCode = err.statusCode || 500;
    if (statusCode >= 500) console.error('[companies/reject]', err);
    return res.status(statusCode).json({ error: err.message || 'Failed to reject company' });
  }
});

router.patch("/:companyId/status", auth, async (req, res) => {
  if (req.employee.primaryRole !== "SUPERADMIN")
    return res.status(403).json({ error: "Forbidden" });
  const { status } = req.body || {};
  if (!status || !["approved", "rejected"].includes(status)) {
    return res.status(400).json({ error: "Status must be approved or rejected" });
  }
  const company = await Company.findById(req.params.companyId);
  if (!company) return res.status(404).json({ error: "Company not found" });

  try {
    const populated = await transitionCompanyStatus(company, status);
    return res.json({ company: populated });
  } catch (err) {
    const statusCode = err.statusCode || 500;
    if (statusCode >= 500) console.error('[companies/status]', err);
    return res.status(statusCode).json({ error: err.message || 'Failed to update company status' });
  }
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
    personalEmail,
    bloodGroup,
    dob,
    reportingPerson,
    employeeId,
    ctc,
    joiningDate,
  } = req.body;
  if (!name || !email || !password || !role || !employeeId)
    return res.status(400).json({ error: "Missing fields" });
  if (!isValidEmail(email)) return res.status(400).json({ error: "Invalid email" });
  if (!isValidPassword(password)) return res.status(400).json({ error: "Password must be more than 5 characters" });
  if (phone !== undefined && phone !== null && String(phone).trim() !== "") {
    if (!isValidPhone(phone)) return res.status(400).json({ error: "Phone must be exactly 10 digits" });
  }
  let personalEmailNormalized;
  if (personalEmail !== undefined && personalEmail !== null && String(personalEmail).trim() !== "") {
    personalEmailNormalized = String(personalEmail).trim();
    if (!isValidEmail(personalEmailNormalized)) {
      return res.status(400).json({ error: "Invalid personal email" });
    }
  }
  const hasBloodGroup =
    bloodGroup !== undefined &&
    bloodGroup !== null &&
    String(bloodGroup).trim() !== "";
  const normalizedBloodGroup = hasBloodGroup
    ? normalizeBloodGroup(bloodGroup)
    : undefined;
  if (hasBloodGroup && !normalizedBloodGroup) {
    return res.status(400).json({ error: "Invalid blood group" });
  }
  let parsedJoiningDate;
  if (joiningDate !== undefined && joiningDate !== null && String(joiningDate).trim() !== "") {
    const jd = new Date(joiningDate);
    if (Number.isNaN(jd.getTime())) {
      return res.status(400).json({ error: "Invalid joining date" });
    }
    parsedJoiningDate = jd;
  }
  const company = await Company.findOne({ admin: req.employee.id });
  if (!company) return res.status(400).json({ error: "Company not found" });
  if (!company.roles.includes(role))
    return res.status(400).json({ error: "Invalid role" });
  let existing = await Employee.findOne({ $or: [{ email }, { employeeId }] });
  if (existing)
    return res.status(400).json({ error: "Employee already exists" });
  const passwordHash = await bcrypt.hash(password, 10);
  const documents = (req.files || []).map((f) => f.filename);
  const reportingInput =
    req.body.reportingPersons !== undefined
      ? req.body.reportingPersons
      : reportingPerson;
  let reportingDocs = [];
  try {
    reportingDocs = await resolveReportingEmployees(
      company._id,
      reportingInput
    );
  } catch (err) {
    return res
      .status(err?.statusCode || err?.status || 400)
      .json({ error: err?.message || "Reporting person not found" });
  }
  const reportingIds = reportingDocs.map((doc) => doc._id);
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
    phone: phone ? normalizePhone(phone) : undefined,
    personalEmail: personalEmailNormalized,
    bloodGroup: normalizedBloodGroup,
    dob: dob ? new Date(dob) : undefined,
    joiningDate: parsedJoiningDate,
    employeeId,
    ctc: Number.isFinite(Number(ctc)) ? Number(ctc) : 0,
    documents,
    reportingPerson: reportingIds[0] || undefined,
    reportingPersons: reportingIds,
    leaveBalances,
  });
  try { employee.decryptFieldsSync(); } catch (_) {}
  res.json({
    employee: {
      id: employee._id,
      name: employee.name,
      email: employee.email,
      personalEmail: employee.personalEmail || '',
      bloodGroup: employee.bloodGroup || '',
      joiningDate: employee.joiningDate,
      subRoles: employee.subRoles,
      reportingPersons: formatReportingResponse(reportingDocs),
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
      applicableFrom: formatApplicableMonth(lp.applicableFrom),
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
  const { totalAnnual, ratePerMonth, typeCaps, applicableFrom } = req.body || {};
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
  const previousApplicable = company.leavePolicy?.applicableFrom || undefined;
  let applicableFromDate = previousApplicable;
  if (applicableFrom === null) {
    applicableFromDate = undefined;
  } else if (typeof applicableFrom !== 'undefined') {
    const parsed = parseApplicableMonth(applicableFrom);
    if (!parsed && typeof applicableFrom === 'string' && applicableFrom.trim()) {
      return res.status(400).json({ error: "Invalid leave applicable date" });
    }
    applicableFromDate = parsed ?? previousApplicable;
  }
  company.leavePolicy = {
    totalAnnual: total,
    ratePerMonth: rpm,
    applicableFrom: applicableFromDate,
    typeCaps: caps,
  };
  await company.save();
  const updated = company.leavePolicy || {};

  ;(async () => {
    try {
      const employees = await Employee.find({ company: company._id }).select(
        "company totalLeaveAvailable leaveUsage leaveAccrual joiningDate createdAt"
      );
      for (const emp of employees) {
        try {
          await accrueTotalIfNeeded(emp, company, new Date());
          await syncLeaveBalances(emp);
        } catch (err) {
          console.warn('[companies/leave-policy] failed to sync employee', String(emp._id), err?.message || err);
        }
      }
    } catch (err) {
      console.warn('[companies/leave-policy] failed to refresh employees', err?.message || err);
    }
  })();

  res.json({
    leavePolicy: {
      totalAnnual: updated.totalAnnual || 0,
      ratePerMonth: updated.ratePerMonth || 0,
      applicableFrom: formatApplicableMonth(updated.applicableFrom),
      typeCaps: {
        paid: updated.typeCaps?.paid || 0,
        casual: updated.typeCaps?.casual || 0,
        sick: updated.typeCaps?.sick || 0,
      },
    },
  });
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
  const { reportingPersons, reportingPerson } = req.body;
  const company = await Company.findOne({ admin: req.employee.id });
  if (!company) return res.status(400).json({ error: "Company not found" });
  const employee = await Employee.findById(req.params.id);
  if (!employee || !employee.company.equals(company._id))
    return res.status(404).json({ error: "Employee not found" });

  const reportingInput =
    reportingPersons !== undefined ? reportingPersons : reportingPerson;
  let reportingDocs = [];
  try {
    reportingDocs = await resolveReportingEmployees(
      company._id,
      reportingInput
    );
  } catch (err) {
    return res
      .status(err?.statusCode || err?.status || 400)
      .json({ error: err?.message || "Reporting person not found" });
  }
  const reportingIds = reportingDocs.map((doc) => doc._id);
  employee.reportingPersons = reportingIds;
  employee.reportingPerson = reportingIds[0] || undefined;

  await employee.save();
  res.json({
    employee: {
      id: employee._id,
      reportingPerson: employee.reportingPerson || null,
      reportingPersons: formatReportingResponse(reportingDocs),
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
    joiningDate,
    personalEmail,
    bloodGroup,
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
  if (phone !== undefined) {
    if (phone === null || String(phone).trim() === '') {
      employee.phone = undefined;
    } else {
      if (!isValidPhone(phone)) return res.status(400).json({ error: 'Phone must be exactly 10 digits' });
      employee.phone = normalizePhone(phone);
    }
  }
  if (dob) {
    const d = new Date(dob);
    if (isNaN(d.getTime())) return res.status(400).json({ error: 'Invalid DOB' });
    employee.dob = d;
  }
  if (joiningDate !== undefined) {
    if (joiningDate === null || String(joiningDate).trim() === '') {
      employee.joiningDate = undefined;
    } else {
      const jd = new Date(joiningDate);
      if (isNaN(jd.getTime())) return res.status(400).json({ error: 'Invalid joining date' });
      employee.joiningDate = jd;
    }
  }
  if (personalEmail !== undefined) {
    if (personalEmail === null || String(personalEmail).trim() === '') {
      employee.personalEmail = undefined;
    } else {
      const trimmed = String(personalEmail).trim();
      if (!isValidEmail(trimmed)) return res.status(400).json({ error: 'Invalid personal email' });
      employee.personalEmail = trimmed;
    }
  }
  if (bloodGroup !== undefined) {
    if (bloodGroup === null || String(bloodGroup).trim() === '') {
      employee.bloodGroup = undefined;
    } else {
      const normalized = normalizeBloodGroup(bloodGroup);
      if (!normalized) return res.status(400).json({ error: 'Invalid blood group' });
      employee.bloodGroup = normalized;
    }
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
  await accrueTotalIfNeeded(employee, company, new Date());
  await syncLeaveBalances(employee);
  try { employee.decryptFieldsSync(); } catch (_) {}
  const responsePersonalEmail = employee.personalEmail || '';
  const responseBloodGroup = employee.bloodGroup || '';
  const responseJoiningDate = employee.joiningDate || null;
  res.json({
    employee: {
      id: employee._id,
      address: employee.address || '',
      phone: employee.phone || '',
      dob: employee.dob,
      joiningDate: responseJoiningDate,
      personalEmail: responsePersonalEmail,
      bloodGroup: responseBloodGroup,
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

// Admin: adjust an employee's total leave balance (supports positive or negative deltas)
router.post("/employees/:id/leave-adjust", auth, async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });

  const { amount } = req.body || {};
  const delta = Number(amount);
  if (!Number.isFinite(delta)) {
    return res.status(400).json({ error: "Amount must be a number" });
  }

  const company = await Company.findOne({ admin: req.employee.id }).select("_id leavePolicy");
  if (!company) return res.status(400).json({ error: "Company not found" });

  const employee = await Employee.findById(req.params.id);
  if (!employee || !employee.company.equals(company._id))
    return res.status(404).json({ error: "Employee not found" });

  await accrueTotalIfNeeded(employee, company, new Date());
  const current = Number(employee.totalLeaveAvailable) || 0;
  employee.totalLeaveAvailable = current + delta;
  employee.leaveAccrual = employee.leaveAccrual || {};
  const existingAdjustment = Number(employee.leaveAccrual.manualAdjustment) || 0;
  employee.leaveAccrual.manualAdjustment = existingAdjustment + delta;
  await employee.save();
  await syncLeaveBalances(employee);

  res.json({
    employee: {
      id: employee._id,
      totalLeaveAvailable: employee.totalLeaveAvailable || 0,
      leaveBalances: employee.leaveBalances || {
        paid: 0,
        casual: 0,
        sick: 0,
        unpaid: 0,
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
  const impacted = await Employee.find({
    company: company._id,
    $or: [
      { reportingPerson: employee._id },
      { reportingPersons: employee._id },
    ],
  });
  for (const other of impacted) {
    const filtered = (other.reportingPersons || []).filter(
      (id) => String(id) !== String(employee._id)
    );
    other.reportingPersons = filtered;
    if (
      other.reportingPerson &&
      String(other.reportingPerson) === String(employee._id)
    ) {
      other.reportingPerson = filtered[0] || undefined;
    }
    await other.save();
  }

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
    .select("name email subRoles primaryRole")
    .lean();
  res.json({
    employees: employees.map((u) => ({
      id: u._id,
      name: u.name,
      email: u.email,
      subRoles: u.subRoles,
      primaryRole: u.primaryRole,
    })),
  });
});

module.exports = router;
