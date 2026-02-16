const router = require("express").Router();
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const { auth } = require("../middleware/auth");
const Company = require("../models/Company");
const Employee = require("../models/Employee");
const Project = require("../models/Project");
const CompanyDayOverride = require("../models/CompanyDayOverride");
const MasterCountry = require("../models/MasterCountry");
const MasterState = require("../models/MasterState");
const MasterCity = require("../models/MasterCity");
const InventoryItem = require("../models/InventoryItem");
const CompanyTypeMaster = require("../models/CompanyTypeMaster");
const {
  upload,
  logoUpload,
  avatarUpload,
  persistImageFromFile,
  getStoredFileId,
  getEmployeeStorageId,
} = require("../utils/fileStorage");
const { normalizeSingleMediaUrl } = require("../utils/mediaUrl");
const { syncLeaveBalances, accrueTotalIfNeeded } = require("../utils/leaveBalances");
const { sendMail, isEmailEnabled, invalidateCompanyTransporter } = require("../utils/mailer");
const {
  isValidEmail,
  isValidPassword,
  isValidPhone,
  normalizePhone,
  normalizeAadhaar,
  isValidAadhaar,
  normalizePan,
  isValidPan,
} = require("../utils/validate");
const {
  permissionModules,
  ensureCompanyRoleDefaults,
  mapRolesForResponse,
  sanitizeIncomingPermissions,
  slugifyRoleName,
  formatRoleLabel,
  DEFAULT_ROLE_CONFIGS,
} = require("../utils/permissions");
const {
  DEFAULT_SANDWICH_MIN_DAYS,
  normalizeSandwichMinDays,
} = require("../utils/sandwich");

function sendSuccess(res, message, payload = {}) {
  if (message) res.set("X-Success-Message", message);
  return res.json({ message, ...payload });
}

// Utility: simple hex validation
function isHexColor(v) {
  return typeof v === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v.trim());
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function parseDateOnly(value) {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  const parts = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!parts) {
    const d = new Date(str);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const year = Number(parts[1]);
  const monthIdx = Number(parts[2]) - 1;
  const day = Number(parts[3]);
  const dt = new Date(Date.UTC(year, monthIdx, day));
  return Number.isNaN(dt.getTime()) ? null : dt;
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

const INVENTORY_STATUSES = ['AVAILABLE', 'ASSIGNED', 'REPAIR', 'RETIRED'];
function normalizeInventoryStatus(value, fallback = 'AVAILABLE') {
  if (typeof value !== 'string') return fallback;
  const v = value.trim().toUpperCase();
  return INVENTORY_STATUSES.includes(v) ? v : fallback;
}

function normalizeDateOnly(value) {
  if (!value) return null;
  const d = startOfDay(new Date(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeCategoryName(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.slice(0, 100);
}

function normalizeReportingIdStrings(body) {
  const raw = [];
  const pushValue = (value) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach(pushValue);
    } else {
      raw.push(String(value));
    }
  };
  if (body) {
    pushValue(body.reportingPersons);
    pushValue(body.reportingPerson);
  }
  const unique = new Set(
    raw
      .map((v) => v.trim())
      .filter((v) => v.length > 0)
  );
  return Array.from(unique);
}

function filterValidObjectIds(strings) {
  const valid = [];
  for (const id of strings) {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    valid.push(id);
  }
  return valid;
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

async function persistEmployeePhoto(employee, file) {
  if (!file) throw httpError(400, "No photo uploaded");
  if (!/^image\//i.test(file.mimetype || "")) {
    throw httpError(400, "Profile image must be an image");
  }
  const employeeStorageId = getEmployeeStorageId(employee);
  const stored = normalizeSingleMediaUrl(
    await persistImageFromFile(file, {
      publicId: `employee-${employeeStorageId}-profile`,
      folder: `employees/${employeeStorageId}/profile`,
    })
  );
  employee.profileImage = stored;
  await employee.save();
  return stored;
}

async function persistCompanyLogo(company, file, variantKey) {
  if (!file) throw httpError(400, "No logo file uploaded");
  if (!/^image\//i.test(file.mimetype || "")) {
    throw httpError(400, "Logo must be an image");
  }
  const stored = normalizeSingleMediaUrl(
    await persistImageFromFile(file, {
      publicId: `company-${company._id}-${variantKey}`,
    })
  );
  company[variantKey] = stored;
  await company.save();
  return stored;
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
    employmentStatus: "PERMANENT",
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
  return sendSuccess(res, "Theme updated", { theme: company.theme });
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
  return sendSuccess(res, "Theme reset", { theme: null });
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
  sendSuccess(res, "Company profile updated", { company: {
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
    return sendSuccess(res, "SMTP disabled", {
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

  sendSuccess(res, "SMTP settings updated", {
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
router.post("/logo", auth, logoUpload.single("logo"), async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });
  try {
    if (!req.file) return res.status(400).json({ error: "No logo file uploaded" });
    const company = await Company.findOne({ admin: req.employee.id });
    if (!company) return res.status(400).json({ error: "Company not found" });
    const logo = await persistCompanyLogo(company, req.file, "logo");
    return sendSuccess(res, "Logo uploaded", { logo });
  } catch (e) {
    const status = e?.statusCode || 500;
    const message = e?.statusCode ? e.message : "Failed to upload logo";
    return res.status(status).json({ error: message });
  }
});

// Admin: upload/replace square logo
router.post("/logo-square", auth, logoUpload.single("logo"), async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });
  try {
    if (!req.file) return res.status(400).json({ error: "No logo file uploaded" });
    const company = await Company.findOne({ admin: req.employee.id });
    if (!company) return res.status(400).json({ error: "Company not found" });
    const logoSquare = await persistCompanyLogo(company, req.file, "logoSquare");
    return sendSuccess(res, "Square logo uploaded", { logoSquare });
  } catch (e) {
    const status = e?.statusCode || 500;
    const message = e?.statusCode ? e.message : "Failed to upload square logo";
    return res.status(status).json({ error: message });
  }
});

// Admin: upload/replace horizontal logo
router.post("/logo-horizontal", auth, logoUpload.single("logo"), async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });
  try {
    if (!req.file) return res.status(400).json({ error: "No logo file uploaded" });
    const company = await Company.findOne({ admin: req.employee.id });
    if (!company) return res.status(400).json({ error: "Company not found" });
    const logoHorizontal = await persistCompanyLogo(company, req.file, "logoHorizontal");
    return sendSuccess(res, "Horizontal logo uploaded", { logoHorizontal });
  } catch (e) {
    const status = e?.statusCode || 500;
    const message = e?.statusCode
      ? e.message
      : "Failed to upload horizontal logo";
    return res.status(status).json({ error: message });
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

    const seededDefaults = ensureCompanyRoleDefaults(company);
    if (seededDefaults) await company.save();

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

    return sendSuccess(res, "Registration submitted. Awaiting superadmin approval.", {
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
    employmentStatus: "PERMANENT",
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

  const seededDefaults = ensureCompanyRoleDefaults(company);
  if (seededDefaults) await company.save();

  sendSuccess(res, "Company created", { company });
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
    employmentStatus: "PERMANENT",
  });
  company.admin = admin._id;
  await company.save();
  const populated = await company.populate("admin", "name email");
  sendSuccess(res, "Admin assigned", { company: populated });
});

// Superadmin: approve a pending company registration
router.post("/:companyId/approve", auth, async (req, res) => {
  if (req.employee.primaryRole !== "SUPERADMIN")
    return res.status(403).json({ error: "Forbidden" });
  const company = await Company.findById(req.params.companyId);
  if (!company) return res.status(404).json({ error: "Company not found" });
  try {
    const populated = await approvePendingCompany(company);
    return sendSuccess(res, "Company approved", { company: populated });
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
    return sendSuccess(res, "Company rejected", { company: populated });
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
    return sendSuccess(res, "Company status updated", { company: populated });
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
  const company = await Company.findOne({ admin: req.employee.id });
  if (!company) return res.status(400).json({ error: "Company not found" });

  const changed = ensureCompanyRoleDefaults(company);
  if (changed) await company.save();

  res.json({
    roles: mapRolesForResponse(company),
    modules: permissionModules,
  });
});

// Admin: add a role to their company
router.post("/roles", auth, async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });

  const { label, role, permissions, description } = req.body || {};
  const rawName = slugifyRoleName(role || label);
  if (!rawName) return res.status(400).json({ error: "Provide a role name" });

  const company = await Company.findOne({ admin: req.employee.id });
  if (!company) return res.status(400).json({ error: "Company not found" });

  ensureCompanyRoleDefaults(company);
  if (company.roles.includes(rawName))
    return res.status(400).json({ error: "Role already exists" });

  const fallback = DEFAULT_ROLE_CONFIGS[rawName]?.modules;
  const sanitizedPermissions = sanitizeIncomingPermissions(
    permissions,
    fallback
  );

  company.roles.push(rawName);
  company.roleSettings[rawName] = {
    label: typeof label === "string" && label.trim() ? label.trim() : formatRoleLabel(rawName),
    description:
      typeof description === "string" ? description.trim() : "",
    modules: sanitizedPermissions,
    system: false,
    canDelete: true,
    allowRename: true,
  };

  company.markModified("roles");
  company.markModified("roleSettings");
  await company.save();

  sendSuccess(res, "Role added", { roles: mapRolesForResponse(company) });
});

function resolveRoleKey(company, incomingKey) {
  if (!company || !incomingKey) return null;
  const settings = company.roleSettings || {};
  if (settings[incomingKey]) return incomingKey;

  const normalizedParam = slugifyRoleName(incomingKey);
  if (!normalizedParam) return null;
  if (settings[normalizedParam]) return normalizedParam;

  const relaxedMatch = Object.keys(settings).find(
    (key) => slugifyRoleName(key) === normalizedParam
  );
  return relaxedMatch || null;
}

// Admin: update role metadata or rename
router.put("/roles/:role", auth, async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });

  const { role } = req.params;
  const { newRole, label, description, permissions } = req.body || {};

  const company = await Company.findOne({ admin: req.employee.id });
  if (!company) return res.status(400).json({ error: "Company not found" });

  ensureCompanyRoleDefaults(company);

  let targetKey = resolveRoleKey(company, role);
  if (!targetKey)
    return res.status(404).json({ error: "Role not found" });

  let targetMeta = company.roleSettings[targetKey];

  if (newRole) {
    const slug = slugifyRoleName(newRole);
    if (!slug) return res.status(400).json({ error: "Invalid role name" });
    if (slug !== targetKey && company.roles.includes(slug))
      return res.status(400).json({ error: "Role already exists" });
    if (targetMeta.system && !targetMeta.allowRename)
      return res.status(400).json({ error: "Cannot rename protected role" });

    const idx = company.roles.indexOf(targetKey);
    if (idx === -1) return res.status(404).json({ error: "Role not found" });

    company.roles[idx] = slug;
    company.roleSettings[slug] = { ...targetMeta };
    delete company.roleSettings[targetKey];
    targetKey = slug;
    targetMeta = company.roleSettings[slug];

    await Employee.updateMany(
      { company: company._id, subRoles: targetKey },
      { $set: { "subRoles.$": slug } }
    );
  }

  if (typeof label === "string") {
    targetMeta.label = label.trim() || formatRoleLabel(targetKey);
  }

  if (typeof description === "string") {
    targetMeta.description = description.trim();
  }

  if (permissions && typeof permissions === "object") {
    const fallback = DEFAULT_ROLE_CONFIGS[targetKey]?.modules;
    targetMeta.modules = sanitizeIncomingPermissions(permissions, fallback);
  }

  company.roleSettings[targetKey] = targetMeta;
  ensureCompanyRoleDefaults(company);
  company.markModified("roles");
  company.markModified("roleSettings");
  await company.save();

  sendSuccess(res, "Role updated", { roles: mapRolesForResponse(company) });
});

// Admin: delete a custom role
router.delete("/roles/:role", auth, async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });

  const { role } = req.params;
  const company = await Company.findOne({ admin: req.employee.id });
  if (!company) return res.status(400).json({ error: "Company not found" });

  ensureCompanyRoleDefaults(company);

  const settings = company.roleSettings || {};
  const targetKey = resolveRoleKey(company, role);
  const meta = targetKey ? settings[targetKey] : null;
  if (!meta) return res.status(404).json({ error: "Role not found" });
  if (meta.system || meta.canDelete === false)
    return res.status(400).json({ error: "Cannot delete protected role" });

  company.roles = company.roles.filter((r) => r !== targetKey);
  delete settings[targetKey];

  const removedCount = await Employee.updateMany(
    {
      company: company._id,
      subRoles: targetKey,
    },
    { $pull: { subRoles: targetKey } }
  );
  if (removedCount.modifiedCount > 0) {
    console.log(
      `[companies] role ${role} removed from ${removedCount.modifiedCount} employees`
    );
  }

  company.markModified("roles");
  company.markModified("roleSettings");
  await company.save();

  sendSuccess(res, "Role deleted", { roles: mapRolesForResponse(company) });
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
    aadharNumber,
    panNumber,
    attendanceStartDate,
    uan,
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
     const jd = parseDateOnly(joiningDate);
    if (!jd) {
      return res.status(400).json({ error: "Invalid joining date" });
    }
    parsedJoiningDate = jd;
  }
  let parsedAttendanceStart;
  if (
    attendanceStartDate !== undefined &&
    attendanceStartDate !== null &&
    String(attendanceStartDate).trim() !== ""
  ) {
    const asd = parseDateOnly(attendanceStartDate);
    if (!asd) {
      return res.status(400).json({ error: "Invalid attendance start date" });
    }
    parsedAttendanceStart = asd;
  }
  const normalizedAttendanceStart =
    parsedJoiningDate && parsedAttendanceStart && parsedAttendanceStart < parsedJoiningDate
      ? parsedJoiningDate
      : parsedAttendanceStart || parsedJoiningDate || undefined;
  let normalizedAadhaar;
  if (aadharNumber !== undefined && aadharNumber !== null) {
    const rawAadhaar = String(aadharNumber).trim();
    const digits = normalizeAadhaar(rawAadhaar);
    if (rawAadhaar && !digits) {
      return res.status(400).json({ error: "Invalid Aadhar number" });
    }
    if (digits && !isValidAadhaar(digits)) {
      return res.status(400).json({ error: "Invalid Aadhar number" });
    }
    normalizedAadhaar = digits || undefined;
  }
  let normalizedPan;
  if (panNumber !== undefined && panNumber !== null) {
    const rawPan = String(panNumber).trim();
    if (rawPan) {
      const pan = normalizePan(rawPan);
      if (!isValidPan(pan)) {
        return res.status(400).json({ error: "Invalid PAN number" });
      }
      normalizedPan = pan;
    } else {
      normalizedPan = undefined;
    }
  }
  let normalizedUan;
  if (uan !== undefined && uan !== null) {
    const rawUan = String(uan).trim();
    const digits = rawUan.replace(/\D/g, "");
    if (rawUan && digits.length !== 12) {
      return res.status(400).json({ error: "UAN must be 12 digits" });
    }
    normalizedUan = digits || undefined;
  }
  const company = await Company.findOne({ admin: req.employee.id });
  if (!company) return res.status(400).json({ error: "Company not found" });

  const ensured = ensureCompanyRoleDefaults(company);
  if (ensured) await company.save();
  if (!company.roles.includes(role))
    return res.status(400).json({ error: "Invalid role" });
  let existing = await Employee.findOne({ $or: [{ email }, { employeeId }] });
  if (existing)
    return res.status(400).json({ error: "Employee already exists" });
  const passwordHash = await bcrypt.hash(password, 10);
  const documents = (req.files || [])
    .map((f) => getStoredFileId(f))
    .filter(Boolean);
  const reportingIdStrings = normalizeReportingIdStrings(req.body);
  const reportingIds = filterValidObjectIds(reportingIdStrings);
  if (reportingIdStrings.length && reportingIds === null)
    return res.status(400).json({ error: "Invalid reporting person" });

  let reportingDocs = [];
  if (reportingIds && reportingIds.length) {
    const docs = await Employee.find({
      _id: { $in: reportingIds },
      company: company._id,
    })
      .select("name")
      .lean();
    if (docs.length !== reportingIds.length)
      return res.status(400).json({ error: "Reporting person not found" });
    const docMap = new Map(docs.map((d) => [String(d._id), d]));
    reportingDocs = reportingIds
      .map((id) => docMap.get(id))
      .filter(Boolean);
  }
  const reportingObjectIds = reportingDocs.map((d) => d._id);

  const reportingResponse = reportingDocs.map((doc) => ({
    id: doc._id,
    name: doc.name,
  }));

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
    attendanceStartDate: normalizedAttendanceStart,
    employeeId,
    ctc: Number.isFinite(Number(ctc)) ? Number(ctc) : 0,
    documents,
    reportingPerson: reportingObjectIds[0] || undefined,
    reportingPersons: reportingObjectIds,
    leaveBalances,
    aadharNumber: normalizedAadhaar,
    panNumber: normalizedPan,
    uan: normalizedUan,
    employmentStatus: "PROBATION",
    probationSince: parsedJoiningDate || new Date(),
  });
  try { employee.decryptFieldsSync(); } catch (_) {}
  sendSuccess(res, "Employee created", {
    employee: {
      id: employee._id,
      name: employee.name,
      email: employee.email,
      personalEmail: employee.personalEmail || '',
      bloodGroup: employee.bloodGroup || '',
      joiningDate: employee.joiningDate,
      attendanceStartDate: employee.attendanceStartDate || employee.joiningDate || null,
      subRoles: employee.subRoles,
      aadharNumber: employee.aadharNumber || '',
      panNumber: employee.panNumber || '',
      uan: employee.uan || '',
      reportingPersons: reportingResponse,
      reportingPerson: reportingResponse[0] || null,
      employmentStatus: employee.employmentStatus || 'PROBATION',
      probationSince: employee.probationSince || null,
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
      probationRatePerMonth: lp.probationRatePerMonth || 0,
      accrualStrategy: lp.accrualStrategy || 'ACCRUAL',
      applicableFrom: formatApplicableMonth(lp.applicableFrom),
      typeCaps: {
        paid: lp.typeCaps?.paid || 0,
        casual: lp.typeCaps?.casual || 0,
        sick: lp.typeCaps?.sick || 0,
      },
      sandwich: {
        enabled: !!lp.sandwich?.enabled,
        minDays: normalizeSandwichMinDays(
          lp.sandwich?.minDays,
          DEFAULT_SANDWICH_MIN_DAYS
        ),
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
  const wh = company.workHours || {};
  const minFull = Number.isFinite(wh.minFullDayHours)
    ? wh.minFullDayHours
    : 6;
  const minHalf = Number.isFinite(wh.minHalfDayHours)
    ? wh.minHalfDayHours
    : 3;
  res.json({
    workHours: {
      start: wh.start || "",
      end: wh.end || "",
      graceMinutes: Number.isFinite(wh.graceMinutes) ? wh.graceMinutes : 0,
      minFullDayHours: minFull,
      minHalfDayHours: Math.min(minHalf, minFull),
    },
  });
});

// Admin: update work hours (company timing)
router.put("/work-hours", auth, async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });
  const { start, end, graceMinutes, minFullDayHours, minHalfDayHours } = req.body || {};
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

  const fullHours = parseFloat(minFullDayHours);
  const halfHours = parseFloat(minHalfDayHours);
  if (!Number.isFinite(fullHours) || fullHours <= 0)
    return res.status(400).json({ error: "Invalid minimum hours for full day" });
  if (!Number.isFinite(halfHours) || halfHours < 0)
    return res.status(400).json({ error: "Invalid minimum hours for half day" });
  if (halfHours > fullHours)
    return res.status(400).json({ error: "Half-day hours cannot exceed full-day hours" });

  const company = await Company.findOne({ admin: req.employee.id });
  if (!company) return res.status(400).json({ error: "Company not found" });
  company.workHours = {
    start,
    end,
    graceMinutes: gm,
    minFullDayHours: fullHours,
    minHalfDayHours: halfHours,
  };
  await company.save();
  sendSuccess(res, "Work hours updated", { workHours: company.workHours });
});

// Admin: update leave policy for their company
router.put("/leave-policy", auth, async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });
  const {
    totalAnnual,
    ratePerMonth,
    probationRatePerMonth,
    accrualStrategy,
    typeCaps,
    applicableFrom,
    sandwich,
  } = req.body || {};
  const company = await Company.findOne({ admin: req.employee.id });
  if (!company) return res.status(400).json({ error: "Company not found" });
  const total = Number(totalAnnual) || 0;
  const rpm = Number(ratePerMonth) || 0;
  const probationRpm = Number(probationRatePerMonth) || 0;
  const strategy = typeof accrualStrategy === 'string'
    ? accrualStrategy.toUpperCase()
    : 'ACCRUAL';
  const caps = {
    paid: Number(typeCaps?.paid) || 0,
    casual: Number(typeCaps?.casual) || 0,
    sick: Number(typeCaps?.sick) || 0,
  };
  const sandwichEnabled = !!(
    sandwich && (sandwich.enabled === true || sandwich.enabled === "true")
  );
  const sandwichMinDays = normalizeSandwichMinDays(
    sandwich?.minDays,
    DEFAULT_SANDWICH_MIN_DAYS
  );
  if (!['ACCRUAL', 'LUMP_SUM'].includes(strategy))
    return res.status(400).json({ error: 'Invalid accrual strategy' });
  if (total < 0 || rpm < 0 || probationRpm < 0)
    return res.status(400).json({ error: "Invalid totals" });
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
    probationRatePerMonth: probationRpm,
    accrualStrategy: strategy,
    applicableFrom: applicableFromDate,
    typeCaps: caps,
    sandwich: {
      enabled: sandwichEnabled,
      minDays: sandwichMinDays,
    },
  };
  await company.save();
  const updated = company.leavePolicy || {};

  ;(async () => {
    try {
      const employees = await Employee.find({ company: company._id }).select(
        "company totalLeaveAvailable leaveUsage leaveAccrual joiningDate createdAt employmentStatus probationSince"
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

  sendSuccess(res, "Leave policy updated", {
    leavePolicy: {
      totalAnnual: updated.totalAnnual || 0,
      ratePerMonth: updated.ratePerMonth || 0,
      probationRatePerMonth: updated.probationRatePerMonth || 0,
      accrualStrategy: updated.accrualStrategy || 'ACCRUAL',
      applicableFrom: formatApplicableMonth(updated.applicableFrom),
      typeCaps: {
        paid: updated.typeCaps?.paid || 0,
        casual: updated.typeCaps?.casual || 0,
        sick: updated.typeCaps?.sick || 0,
      },
      sandwich: {
        enabled: !!updated.sandwich?.enabled,
        minDays: normalizeSandwichMinDays(
          updated.sandwich?.minDays,
          DEFAULT_SANDWICH_MIN_DAYS
        ),
      },
    },
  });
});

// List bank holidays (visible to all authenticated employees of the company)
router.get("/bank-holidays", auth, async (req, res) => {
  let company = null;
  if (["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole)) {
    company = await Company.findOne({ admin: req.employee.id }).select(
      "bankHolidays"
    );
  } else if (req.employee.company) {
    company = await Company.findById(req.employee.company).select(
      "bankHolidays"
    );
  }
  if (!company) return res.status(400).json({ error: "Company not found" });
  res.json({ bankHolidays: company.bankHolidays || [] });
});

// Admin: add a bank holiday
router.post("/bank-holidays", auth, async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });
  const { date, name } = req.body;
  if (!date) return res.status(400).json({ error: "Missing date" });
  const normalizedDate = new Date(date);
  if (Number.isNaN(normalizedDate.getTime()))
    return res.status(400).json({ error: "Invalid date" });
  const company = await Company.findOne({ admin: req.employee.id });
  if (!company) return res.status(400).json({ error: "Company not found" });
  const existing = company.bankHolidays?.some(
    (h) =>
      h.date.toISOString().slice(0, 10) ===
      normalizedDate.toISOString().slice(0, 10)
  );
  if (!existing) {
    company.bankHolidays.push({ date: normalizedDate, name });
    await company.save();
  }
  sendSuccess(res, "Bank holiday added", {
    bankHolidays: company.bankHolidays,
  });
});

// Admin: update a bank holiday
router.put("/bank-holidays/:id", auth, async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });
  const { id } = req.params;
  const { date, name } = req.body;
  if (!date) return res.status(400).json({ error: "Missing date" });

  const normalizedDate = new Date(date);
  if (Number.isNaN(normalizedDate.getTime()))
    return res.status(400).json({ error: "Invalid date" });

  const company = await Company.findOne({ admin: req.employee.id });
  if (!company) return res.status(400).json({ error: "Company not found" });

  const holiday = company.bankHolidays.id(id);
  if (!holiday) return res.status(404).json({ error: "Holiday not found" });

  const duplicate = company.bankHolidays.some(
    (h) =>
      h._id.toString() !== id &&
      h.date.toISOString().slice(0, 10) ===
        normalizedDate.toISOString().slice(0, 10)
  );
  if (duplicate)
    return res
      .status(409)
      .json({ error: "A holiday already exists for this date" });

  holiday.date = normalizedDate;
  holiday.name = name;

  await company.save();
  sendSuccess(res, "Bank holiday updated", {
    bankHolidays: company.bankHolidays,
  });
});

// Admin: delete a bank holiday
router.delete("/bank-holidays/:id", auth, async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });
  const { id } = req.params;

  const company = await Company.findOne({ admin: req.employee.id });
  if (!company) return res.status(400).json({ error: "Company not found" });

  const holiday = company.bankHolidays.id(id);
  if (!holiday) return res.status(404).json({ error: "Holiday not found" });

  holiday.deleteOne();
  await company.save();

  sendSuccess(res, "Bank holiday deleted", {
    bankHolidays: company.bankHolidays,
  });
});

// Admin: list company day overrides for a month (or all upcoming)
// GET /companies/day-overrides?month=yyyy-mm
async function findCompanyForEmployee(emp) {
  if (!emp) return null;
  const adminMatch = await Company.findOne({ admin: emp.id || emp._id }).select("_id");
  if (adminMatch) return adminMatch;
  if (emp.company) return Company.findById(emp.company).select("_id");
  return null;
}

router.get("/day-overrides", auth, async (req, res) => {
  const canEdit =
    ["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole) ||
    (req.employee.subRoles || []).some((r) => ["hr", "manager"].includes(r));
  if (!canEdit)
    return res.status(403).json({ error: "Forbidden" });
  const company = await findCompanyForEmployee(req.employee);
  if (!company) return res.status(400).json({ error: "Company not found" });

  const { month } = req.query || {};
  let filter = {
    company: company._id,
    isDeleted: { $ne: true },
    isActive: { $ne: false },
  };
  if (month) {
    const start = startOfDay(new Date(month + "-01"));
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);
    filter = { ...filter, date: { $gte: start, $lt: end } };
  }

  const overrides = await CompanyDayOverride.find(filter).sort({ date: 1 }).lean();
  res.json({ overrides: overrides.map(o => ({
    id: String(o._id),
    date: new Date(o.date).toISOString().slice(0,10),
    type: o.type,
    note: o.note || "",
  })) });
});

// Admin: upsert a company day override
// Body: { date: 'yyyy-mm-dd', type: 'WORKING'|'HOLIDAY'|'HALF_DAY', note? }
router.post("/day-overrides", auth, async (req, res) => {
  const canEdit =
    ["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole) ||
    (req.employee.subRoles || []).some((r) => ["hr", "manager"].includes(r));
  if (!canEdit)
    return res.status(403).json({ error: "Forbidden" });
  const { date, type, note } = req.body || {};
  if (!date || !type) return res.status(400).json({ error: "Missing date or type" });
  if (!['WORKING','HOLIDAY','HALF_DAY'].includes(type))
    return res.status(400).json({ error: "Invalid type" });

  const company = await findCompanyForEmployee(req.employee);
  if (!company) return res.status(400).json({ error: "Company not found" });

  const day = startOfDay(new Date(date));
  if (isNaN(day.getTime())) return res.status(400).json({ error: "Invalid date" });

  await CompanyDayOverride.findOneAndUpdate(
    { company: company._id, date: day },
    {
      $setOnInsert: { company: company._id, date: day },
      $set: {
        type,
        note: note || "",
        updatedBy: req.employee.id,
        isDeleted: false,
        isActive: true,
      },
    },
    { upsert: true }
  );

  const month = `${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,'0')}`;
  const start = startOfDay(new Date(month + "-01"));
  const end = new Date(start); end.setMonth(end.getMonth()+1);
  const overrides = await CompanyDayOverride.find({
    company: company._id,
    isDeleted: { $ne: true },
    isActive: { $ne: false },
    date: { $gte: start, $lt: end },
  })
    .sort({ date: 1 })
    .lean();
  sendSuccess(res, "Override saved", {
    overrides: overrides.map(o => ({ date: new Date(o.date).toISOString().slice(0,10), type: o.type, note: o.note || "" })),
  });
});

// Admin: delete a company day override by date
router.delete("/day-overrides/:date", auth, async (req, res) => {
  const canEdit =
    ["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole) ||
    (req.employee.subRoles || []).some((r) => ["hr", "manager"].includes(r));
  if (!canEdit)
    return res.status(403).json({ error: "Forbidden" });
  const { date: dateOrId } = req.params;
  const company = await findCompanyForEmployee(req.employee);
  if (!company) return res.status(400).json({ error: "Company not found" });
  let deleted = null;

  // Allow deletion by id if provided
  if (mongoose.Types.ObjectId.isValid(dateOrId)) {
    deleted = await CompanyDayOverride.findOneAndUpdate(
      {
        _id: dateOrId,
        company: company._id,
        isDeleted: { $ne: true },
      },
      {
        $set: {
          isDeleted: true,
          isActive: false,
          updatedBy: req.employee.id,
        },
      }
    );
  }

  if (!deleted) {
    const day = startOfDay(parseDateOnly(dateOrId));
    if (isNaN(day.getTime()))
      return res.status(400).json({ error: "Invalid date" });
    const next = new Date(day);
    next.setDate(next.getDate() + 1);
    deleted = await CompanyDayOverride.findOneAndUpdate(
      {
        company: company._id,
        date: { $gte: day, $lt: next },
        isDeleted: { $ne: true },
      },
      {
        $set: {
          isDeleted: true,
          isActive: false,
          updatedBy: req.employee.id,
        },
      }
    );
  }

  if (!deleted) return res.status(404).json({ error: "Override not found" });
  sendSuccess(res, "Override deleted", { ok: true });
});

// Helpers for inventory
async function loadInventoryItems(companyId, filter = {}) {
  return InventoryItem.find({
    company: companyId,
    isDeleted: { $ne: true },
    ...filter,
  })
    .populate("assignedTo", "name email primaryRole")
    .sort({ createdAt: -1 })
    .lean();
}

async function ensureInventoryCategory(companyId, name) {
  const normalized = normalizeCategoryName(name);
  if (!normalized) return;
  await Company.updateOne(
    { _id: companyId },
    {
      $addToSet: {
        inventoryCategories: normalized,
      },
    }
  );
}

async function assertEmployeeInCompany(companyId, employeeId) {
  if (!mongoose.Types.ObjectId.isValid(employeeId)) return null;
  return Employee.findOne({ _id: employeeId, company: companyId }).select(
    "_id name email"
  );
}

// Admin: list inventory items (optional filter by employee)
router.get("/inventory", auth, async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });
  const company = await Company.findOne({ admin: req.employee.id }).select("_id inventoryCategories");
  if (!company) return res.status(400).json({ error: "Company not found" });

  const { employeeId, status, category } = req.query || {};
  const filter = {};
  if (employeeId) {
    const emp = await assertEmployeeInCompany(company._id, employeeId);
    if (!emp) return res.status(404).json({ error: "Employee not found" });
    filter.assignedTo = emp._id;
  }
  if (status) {
    const normalized = normalizeInventoryStatus(status, null);
    if (normalized) filter.status = normalized;
  }
  if (category && typeof category === "string") {
    const normalizedCategory = normalizeCategoryName(category);
    if (normalizedCategory) filter.category = normalizedCategory;
  }

  const items = await loadInventoryItems(company._id, filter);
  res.json({ items, categories: company.inventoryCategories || [] });
});

// Admin: add inventory item
router.post("/inventory", auth, async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });
  const { name, category, cost, status, assignedTo, purchaseDate, notes } =
    req.body || {};
  const company = await Company.findOne({ admin: req.employee.id }).select("_id");
  if (!company) return res.status(400).json({ error: "Company not found" });

  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: "Item name is required" });
  }

  const normalizedCategory = normalizeCategoryName(category);
  let assigned = null;
  if (assignedTo) {
    assigned = await assertEmployeeInCompany(company._id, assignedTo);
    if (!assigned) return res.status(404).json({ error: "Employee not found" });
  }

  const normalizedStatus = assigned
    ? "ASSIGNED"
    : normalizeInventoryStatus(status, "AVAILABLE");
  const costValue =
    cost === undefined || cost === null || cost === ""
      ? 0
      : Number(cost);
  if (!Number.isFinite(costValue) || costValue < 0) {
    return res.status(400).json({ error: "Cost must be a non-negative number" });
  }
  const purchase = normalizeDateOnly(purchaseDate);

  await InventoryItem.create({
    company: company._id,
    name: String(name).trim(),
    category: normalizedCategory,
    cost: costValue,
    status: normalizedStatus,
    assignedTo: assigned ? assigned._id : null,
    purchaseDate: purchase,
    notes: notes ? String(notes) : "",
    isDeleted: false,
  });

  if (normalizedCategory) {
    await ensureInventoryCategory(company._id, normalizedCategory);
  }

  const items = await loadInventoryItems(company._id);
  const companyRefreshed = await Company.findById(company._id).select(
    "inventoryCategories"
  );
  sendSuccess(res, "Inventory item added", {
    items,
    categories: companyRefreshed?.inventoryCategories || [],
  });
});

// Admin: update inventory item
router.put("/inventory/:id", auth, async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });
  const { id } = req.params;
  const {
    name,
    category,
    cost,
    status,
    assignedTo,
    purchaseDate,
    notes,
  } = req.body || {};
  const company = await Company.findOne({ admin: req.employee.id }).select("_id");
  if (!company) return res.status(400).json({ error: "Company not found" });

  const item = await InventoryItem.findOne({
    _id: id,
    company: company._id,
    isDeleted: { $ne: true },
  });
  if (!item) return res.status(404).json({ error: "Item not found" });

  if (name !== undefined) item.name = String(name || "").trim() || item.name;
  if (category !== undefined) {
    const normalizedCategory = normalizeCategoryName(category);
    item.category = normalizedCategory;
    if (normalizedCategory) {
      await ensureInventoryCategory(company._id, normalizedCategory);
    }
  }
  if (notes !== undefined) item.notes = notes ? String(notes) : "";
  if (purchaseDate !== undefined) {
    const purchase = normalizeDateOnly(purchaseDate);
    item.purchaseDate = purchase;
  }
  if (cost !== undefined) {
    const costValue =
      cost === "" || cost === null || cost === undefined ? 0 : Number(cost);
    if (!Number.isFinite(costValue) || costValue < 0) {
      return res
        .status(400)
        .json({ error: "Cost must be a non-negative number" });
    }
    item.cost = costValue;
  }

  if (assignedTo !== undefined) {
    if (assignedTo === null || assignedTo === "") {
      item.assignedTo = null;
    } else {
      const assignee = await assertEmployeeInCompany(company._id, assignedTo);
      if (!assignee)
        return res.status(404).json({ error: "Employee not found" });
      item.assignedTo = assignee._id;
    }
  }

  if (status !== undefined) {
    item.status = normalizeInventoryStatus(
      status,
      item.assignedTo ? "ASSIGNED" : item.status
    );
  } else if (assignedTo !== undefined && assignedTo !== null && assignedTo !== "") {
    item.status = "ASSIGNED";
  }

  await item.save();
  const items = await loadInventoryItems(company._id);
  const companyRefreshed = await Company.findById(company._id).select(
    "inventoryCategories"
  );
  sendSuccess(res, "Inventory item updated", {
    items,
    categories: companyRefreshed?.inventoryCategories || [],
  });
});

// Admin: assign/unassign inventory item
router.put("/inventory/:id/assign", auth, async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });
  const { id } = req.params;
  const { employeeId } = req.body || {};
  const company = await Company.findOne({ admin: req.employee.id }).select("_id");
  if (!company) return res.status(400).json({ error: "Company not found" });

  const item = await InventoryItem.findOne({
    _id: id,
    company: company._id,
    isDeleted: { $ne: true },
  });
  if (!item) return res.status(404).json({ error: "Item not found" });

  if (employeeId) {
    const assignee = await assertEmployeeInCompany(company._id, employeeId);
    if (!assignee) return res.status(404).json({ error: "Employee not found" });
    item.assignedTo = assignee._id;
    item.status = "ASSIGNED";
  } else {
    item.assignedTo = null;
    item.status = normalizeInventoryStatus(item.status, "AVAILABLE");
    if (item.status === "ASSIGNED") item.status = "AVAILABLE";
  }

  await item.save();
  const items = await loadInventoryItems(company._id);
  const companyRefreshed = await Company.findById(company._id).select(
    "inventoryCategories"
  );
  sendSuccess(res, "Assignment updated", {
    items,
    categories: companyRefreshed?.inventoryCategories || [],
  });
});

// Admin: delete inventory item (soft delete)
router.delete("/inventory/:id", auth, async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });
  const { id } = req.params;
  const company = await Company.findOne({ admin: req.employee.id }).select("_id");
  if (!company) return res.status(400).json({ error: "Company not found" });

  const item = await InventoryItem.findOne({
    _id: id,
    company: company._id,
    isDeleted: { $ne: true },
  });
  if (!item) return res.status(404).json({ error: "Item not found" });

  item.isDeleted = true;
  item.assignedTo = null;
  await item.save();

  const items = await loadInventoryItems(company._id);
  const companyRefreshed = await Company.findById(company._id).select(
    "inventoryCategories"
  );
  sendSuccess(res, "Inventory item deleted", {
    items,
    categories: companyRefreshed?.inventoryCategories || [],
  });
});

// Admin: list inventory categories
router.get("/inventory-categories", auth, async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });
  const company = await Company.findOne({ admin: req.employee.id }).select(
    "_id inventoryCategories"
  );
  if (!company) return res.status(400).json({ error: "Company not found" });
  res.json({ categories: company.inventoryCategories || [] });
});

// Admin: add inventory category
router.post("/inventory-categories", auth, async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });
  const { name } = req.body || {};
  const normalized = normalizeCategoryName(name);
  if (!normalized) return res.status(400).json({ error: "Category name required" });
  const company = await Company.findOne({ admin: req.employee.id }).select(
    "_id inventoryCategories"
  );
  if (!company) return res.status(400).json({ error: "Company not found" });

  const exists = (company.inventoryCategories || []).some(
    (c) => c.trim().toLowerCase() === normalized.toLowerCase()
  );
  if (!exists) {
    company.inventoryCategories = [
      ...(company.inventoryCategories || []),
      normalized,
    ];
    await company.save();
  }

  res.set("X-Success-Message", "Category added");
  res.json({ categories: company.inventoryCategories || [] });
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
  sendSuccess(res, "Leave balances reset", { ok: true, count });
});

// Admin: update reporting person of an employee
router.put("/employees/:id/reporting", auth, async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });

  const reportingIdStrings = normalizeReportingIdStrings(req.body);
  const reportingIds = filterValidObjectIds(reportingIdStrings);
  if (reportingIdStrings.length && reportingIds === null)
    return res.status(400).json({ error: "Invalid reporting person" });

  const company = await Company.findOne({ admin: req.employee.id });
  if (!company) return res.status(400).json({ error: "Company not found" });
  const employee = await Employee.findById(req.params.id);
  if (!employee || !employee.company.equals(company._id))
    return res.status(404).json({ error: "Employee not found" });

  const selfId = String(employee._id);
  if (reportingIds && reportingIds.some((id) => id === selfId))
    return res
      .status(400)
      .json({ error: "Employee cannot report to themselves" });

  let reportingDocs = [];
  if (reportingIds && reportingIds.length) {
    const docs = await Employee.find({
      _id: { $in: reportingIds },
      company: company._id,
    })
      .select("name")
      .lean();
    if (docs.length !== reportingIds.length)
      return res.status(400).json({ error: "Reporting person not found" });
    const docMap = new Map(docs.map((d) => [String(d._id), d]));
    reportingDocs = reportingIds.map((id) => docMap.get(id)).filter(Boolean);
  }

  const reportingObjectIds = reportingDocs.map((doc) => doc._id);
  employee.reportingPersons = reportingObjectIds;
  employee.reportingPerson = reportingObjectIds[0] || undefined;

  await employee.save();

  const responseReporting = reportingDocs.map((doc) => ({
    id: doc._id,
    name: doc.name,
  }));

  sendSuccess(res, "Reporting updated", {
    employee: {
      id: employee._id,
      reportingPersons: responseReporting,
      reportingPerson: responseReporting[0] || null,
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
  const ensured = ensureCompanyRoleDefaults(company);
  if (ensured) await company.save();
  if (!company.roles.includes(role))
    return res.status(400).json({ error: "Invalid role" });
  const employee = await Employee.findById(req.params.id);
  if (!employee || !employee.company.equals(company._id))
    return res.status(404).json({ error: "Employee not found" });

  employee.subRoles = [role];
  await employee.save();
  sendSuccess(res, "Employee role updated", {
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
    attendanceStartDate,
    personalEmail,
    bloodGroup,
    ctc,
    aadharNumber,
    panNumber,
    bankDetails,
    email,
    employeeId,
    hasTds,
    uan,
  } = req.body || {};
  const employeeIdAlt =
    (req.body && req.body.employeeID) ||
    (req.body && req.body.employee_id) ||
    undefined;

  // Only admins of the company can update within that company
  const company = await Company.findOne({ admin: req.employee.id });
  if (!company) return res.status(400).json({ error: "Company not found" });

  const employee = await Employee.findById(req.params.id);
  if (!employee || !employee.company.equals(company._id))
    return res.status(404).json({ error: "Employee not found" });

  // Normalize employeeId from any supported key
  if (employeeId !== undefined || employeeIdAlt !== undefined) {
    const rawId =
      employeeId !== undefined ? employeeId : employeeIdAlt !== undefined ? employeeIdAlt : "";
    const normalizedId = String(rawId || "").trim();
    if (!normalizedId) {
      employee.employeeId = undefined;
    } else {
      const existingId = await Employee.findOne({
        employeeId: normalizedId,
        _id: { $ne: employee._id },
      })
        .select("_id company")
        .lean();
      if (existingId) {
        return res
          .status(400)
          .json({ error: "Employee ID already taken" });
      }
      employee.employeeId = normalizedId;
    }
  }

  if (email !== undefined) {
    const trimmed = String(email).trim();
    if (!trimmed) return res.status(400).json({ error: 'Email cannot be empty' });
    if (!isValidEmail(trimmed)) return res.status(400).json({ error: 'Invalid email' });
    const existingEmail = await Employee.findOne({ email: trimmed });
    if (existingEmail && !existingEmail._id.equals(employee._id))
      return res.status(400).json({ error: 'Email already taken' });
    employee.email = trimmed;
  }

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
       const jd = parseDateOnly(joiningDate);
      if (!jd) return res.status(400).json({ error: 'Invalid joining date' });
      employee.joiningDate = jd;
    }
  }
  if (attendanceStartDate !== undefined) {
    if (attendanceStartDate === null || String(attendanceStartDate).trim() === '') {
      employee.attendanceStartDate = employee.joiningDate || undefined;
    } else {
      const asd = parseDateOnly(attendanceStartDate);
      if (!asd) return res.status(400).json({ error: 'Invalid attendance start date' });
      if (employee.joiningDate && asd < employee.joiningDate) {
        employee.attendanceStartDate = employee.joiningDate;
      } else {
        employee.attendanceStartDate = asd;
      }
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
  if (aadharNumber !== undefined) {
    const rawAadhaar = String(aadharNumber).trim();
    const digits = normalizeAadhaar(rawAadhaar);
    if (rawAadhaar && !digits) {
      return res.status(400).json({ error: 'Invalid Aadhar number' });
    }
    if (digits && !isValidAadhaar(digits)) {
      return res.status(400).json({ error: 'Invalid Aadhar number' });
    }
    employee.aadharNumber = digits || undefined;
  }
  if (panNumber !== undefined) {
    const rawPan = String(panNumber).trim();
    if (rawPan) {
      const pan = normalizePan(rawPan);
      if (!isValidPan(pan)) {
        return res.status(400).json({ error: 'Invalid PAN number' });
      }
      employee.panNumber = pan;
    } else {
      employee.panNumber = undefined;
    }
  }
  if (uan !== undefined) {
    const rawUan = String(uan).trim();
    const digits = rawUan.replace(/\D/g, "");
    if (rawUan && digits.length !== 12) {
      return res.status(400).json({ error: "UAN must be 12 digits" });
    }
    employee.uan = digits || undefined;
  }
  if (bankDetails && typeof bankDetails === 'object') {
    employee.bankDetails = employee.bankDetails || {};
    if (typeof bankDetails.accountNumber === 'string') employee.bankDetails.accountNumber = bankDetails.accountNumber.trim();
    if (typeof bankDetails.bankName === 'string') employee.bankDetails.bankName = bankDetails.bankName.trim();
    if (typeof bankDetails.ifsc === 'string') employee.bankDetails.ifsc = bankDetails.ifsc.trim();
  }
  if (hasTds !== undefined) {
    employee.hasTds = !!hasTds;
  }

  await employee.save();
  await accrueTotalIfNeeded(employee, company, new Date());
  await syncLeaveBalances(employee);
  try { employee.decryptFieldsSync(); } catch (_) {}
  const responsePersonalEmail = employee.personalEmail || '';
  const responseBloodGroup = employee.bloodGroup || '';
  const responseJoiningDate = employee.joiningDate || null;
  sendSuccess(res, "Employee updated", {
    employee: {
      id: employee._id,
      address: employee.address || '',
      phone: employee.phone || '',
      dob: employee.dob,
      joiningDate: responseJoiningDate,
      attendanceStartDate: employee.attendanceStartDate || responseJoiningDate,
      personalEmail: responsePersonalEmail,
      bloodGroup: responseBloodGroup,
      ctc: employee.ctc || 0,
      aadharNumber: employee.aadharNumber || '',
      panNumber: employee.panNumber || '',
      email: employee.email,
      bankDetails: {
        accountNumber: employee.bankDetails?.accountNumber || '',
        bankName: employee.bankDetails?.bankName || '',
        ifsc: employee.bankDetails?.ifsc || '',
      },
      uan: employee.uan || '',
      hasTds: !!employee.hasTds,
      profileImage: employee.profileImage || null,
      employeeId: employee.employeeId || '',
    },
  });
});

// Admin: upload/replace an employee profile image
router.post(
  "/employees/:id/photo",
  auth,
  avatarUpload.single("photo"),
  async (req, res) => {
    if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
      return res.status(403).json({ error: "Forbidden" });
    try {
      if (!req.file) return res.status(400).json({ error: "No photo uploaded" });
      const company = await Company.findOne({ admin: req.employee.id }).select("_id");
      if (!company) return res.status(400).json({ error: "Company not found" });
      const employee = await Employee.findById(req.params.id);
      if (!employee || !employee.company.equals(company._id))
        return res.status(404).json({ error: "Employee not found" });
      const profileImage = await persistEmployeePhoto(employee, req.file);
      return sendSuccess(res, "Profile photo uploaded", { profileImage });
    } catch (err) {
      console.error("[companies/employees/:id/photo]", err);
      const status = err?.statusCode || 500;
      const message = err?.statusCode ? err.message : "Failed to upload photo";
      return res.status(status).json({ error: message });
    }
  }
);

// Admin: toggle probation/permanent employment status
router.put("/employees/:id/probation", auth, async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });

  const { status, since } = req.body || {};
  const normalizedStatus =
    typeof status === 'string' ? status.trim().toUpperCase() : '';
  if (!['PROBATION', 'PERMANENT'].includes(normalizedStatus)) {
    return res.status(400).json({ error: 'Invalid employment status' });
  }

  const company = await Company.findOne({ admin: req.employee.id }).select("_id leavePolicy");
  if (!company) return res.status(400).json({ error: "Company not found" });

  const employee = await Employee.findById(req.params.id);
  if (!employee || !employee.company.equals(company._id))
    return res.status(404).json({ error: "Employee not found" });

  await accrueTotalIfNeeded(employee, company, new Date());
  const currentTotal = Number(employee.totalLeaveAvailable) || 0;

  if (normalizedStatus === 'PROBATION') {
    let probationSince = since ? new Date(since) : new Date();
    if (since && Number.isNaN(probationSince.getTime())) {
      return res.status(400).json({ error: 'Invalid probation start date' });
    }
    if (Number.isNaN(probationSince.getTime())) {
      probationSince = new Date();
    }
    employee.employmentStatus = 'PROBATION';
    employee.probationSince = probationSince;
  } else {
    employee.employmentStatus = 'PERMANENT';
    employee.probationSince = undefined;
  }

  await employee.save();

  await accrueTotalIfNeeded(employee, company, new Date());
  const recalculatedTotal = Number(employee.totalLeaveAvailable) || 0;
  const existingAdjustment = Number(employee.leaveAccrual?.manualAdjustment) || 0;
  const delta = currentTotal - recalculatedTotal;
  if (Math.abs(delta) > 1e-6) {
    employee.leaveAccrual = employee.leaveAccrual || {};
    employee.leaveAccrual.manualAdjustment = existingAdjustment + delta;
    employee.totalLeaveAvailable = currentTotal;
  }

  await employee.save();
  await syncLeaveBalances(employee);

  sendSuccess(res, "Employment status updated", {
    employee: {
      id: employee._id,
      employmentStatus: employee.employmentStatus,
      probationSince: employee.probationSince || null,
      totalLeaveAvailable: Number(employee.totalLeaveAvailable) || 0,
      leaveBalances: employee.leaveBalances || {
        paid: 0,
        casual: 0,
        sick: 0,
        unpaid: 0,
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

  sendSuccess(res, "Leave balance adjusted", {
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

// Admin: override unpaid leaves taken for an employee (manual correction)
router.post("/employees/:id/unpaid-taken", auth, async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });

  const { unpaidTaken } = req.body || {};
  const value = Number(unpaidTaken);
  if (!Number.isFinite(value) || value < 0) {
    return res
      .status(400)
      .json({ error: "Unpaid taken must be a non-negative number" });
  }

  const company = await Company.findOne({ admin: req.employee.id }).select(
    "_id leavePolicy"
  );
  if (!company) return res.status(400).json({ error: "Company not found" });

  const employee = await Employee.findById(req.params.id);
  if (!employee || !employee.company.equals(company._id))
    return res.status(404).json({ error: "Employee not found" });

  employee.leaveUsage = employee.leaveUsage || {
    paid: 0,
    casual: 0,
    sick: 0,
    unpaid: 0,
  };
  employee.leaveUsage.unpaid = value;
  await employee.save();
  await syncLeaveBalances(employee);

  sendSuccess(res, "Unpaid leave updated", {
    employee: {
      id: employee._id,
      leaveBalances: employee.leaveBalances || {
        paid: 0,
        casual: 0,
        sick: 0,
        unpaid: 0,
      },
      leaveUsage: employee.leaveUsage,
    },
  });
});

// Admin: delete/disable an employee
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

  // Remove from project memberships
  await Project.updateMany({ members: employee._id }, { $pull: { members: employee._id } });

  const dependents = await Employee.find({
    company: company._id,
    $or: [
      { reportingPerson: employee._id },
      { reportingPersons: employee._id },
    ],
  })
    .select("_id reportingPerson reportingPersons")
    .lean();

  for (const dep of dependents) {
    const currentArray = Array.isArray(dep.reportingPersons)
      ? dep.reportingPersons
      : [];
    const filtered = currentArray.filter(
      (id) => String(id) !== String(employee._id)
    );
    const nextReportingPersons =
      filtered.length !== currentArray.length ? filtered : currentArray;
    const hasPrimary = dep.reportingPerson
      ? String(dep.reportingPerson) === String(employee._id)
      : false;
    let nextReportingPerson = dep.reportingPerson || undefined;
    if (hasPrimary) {
      nextReportingPerson = filtered[0] || undefined;
    } else if (!dep.reportingPerson && filtered.length) {
      nextReportingPerson = filtered[0];
    }
    const setOps = {
      reportingPersons: nextReportingPersons,
    };
    if (nextReportingPerson) {
      setOps.reportingPerson = nextReportingPerson;
      await Employee.updateOne({ _id: dep._id }, { $set: setOps });
    } else {
      await Employee.updateOne(
        { _id: dep._id },
        { $set: setOps, $unset: { reportingPerson: 1 } }
      );
    }
  }

  const { lastWorkingDay, reason, note } = req.body || {};
  if (lastWorkingDay) {
    const parsed = new Date(lastWorkingDay);
    if (Number.isNaN(parsed.getTime()))
      return res.status(400).json({ error: "Invalid last working day" });
    employee.offboarding = employee.offboarding || {};
    employee.offboarding.lastWorkingDay = parsed;
  }
  if (reason) {
    const allowed = [
      "resignation",
      "termination",
      "layoff",
      "contract_end",
      "absconded",
      "other",
    ];
    if (!allowed.includes(reason))
      return res.status(400).json({ error: "Invalid reason" });
    employee.offboarding = employee.offboarding || {};
    employee.offboarding.reason = reason;
  }
  if (note) {
    const trimmed = String(note).trim();
    if (trimmed.length > 2000)
      return res.status(400).json({ error: "Note must be ≤ 2000 chars" });
    employee.offboarding = employee.offboarding || {};
    employee.offboarding.note = trimmed;
  }
  const offboardingSet = {
    "offboarding.recordedBy": req.employee._id,
    "offboarding.recordedAt": new Date(),
  };
  if (employee.offboarding?.lastWorkingDay) {
    offboardingSet["offboarding.lastWorkingDay"] =
      employee.offboarding.lastWorkingDay;
  }
  if (employee.offboarding?.reason) {
    offboardingSet["offboarding.reason"] = employee.offboarding.reason;
  }
  if (employee.offboarding?.note) {
    offboardingSet["offboarding.note"] = employee.offboarding.note;
  }

  await Employee.updateOne(
    { _id: employee._id },
    {
      $set: {
        isDeleted: true,
        isActive: false,
        ...offboardingSet,
      },
    }
  );
  const updatedEmployee = await Employee.findById(employee._id)
    .select("_id isDeleted isActive offboarding")
    .lean();
  sendSuccess(res, "Employee deleted", {
    ok: true,
    employee: {
      id: updatedEmployee?._id || employee._id,
      isDeleted: updatedEmployee?.isDeleted === true,
      isActive: updatedEmployee?.isActive !== false,
      offboarding: updatedEmployee?.offboarding || null,
    },
  });
});

// Admin: restore a soft-deleted / inactive employee
router.put("/employees/:id/restore", auth, async (req, res) => {
  if (!["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole))
    return res.status(403).json({ error: "Forbidden" });
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: "Missing employee id" });
  const company = await Company.findOne({ admin: req.employee.id }).select("_id");
  if (!company) return res.status(400).json({ error: "Company not found" });

  const employee = await Employee.findById(id).select("_id company");
  if (!employee || !employee.company?.equals(company._id))
    return res.status(404).json({ error: "Employee not found" });

  await Employee.updateOne(
    { _id: employee._id },
    {
      $set: { isDeleted: false, isActive: true },
      $unset: { offboarding: 1 },
    }
  );
  sendSuccess(res, "Employee restored", {
    employee: {
      id: employee._id,
      isDeleted: false,
      isActive: true,
      offboarding: null,
    },
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

  const includeDeleted =
    ["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole) &&
    String(req.query.includeDeleted || "").toLowerCase() === "true";
  const includeInactive =
    includeDeleted ||
    String(req.query.includeInactive || "").toLowerCase() === "true";

  const filter = { company: companyId };
  if (!includeDeleted) filter.isDeleted = { $ne: true };
  if (!includeInactive) filter.isActive = { $ne: false };

  const employees = await Employee.find(filter);
  res.json({
    employees: employees.map((u) => ({
      id: u._id,
      name: u.name,
      email: u.email,
      employeeId: u.employeeId || null,
      subRoles: u.subRoles,
      primaryRole: u.primaryRole,
      joiningDate: u.joiningDate || null,
      attendanceStartDate: u.attendanceStartDate || u.joiningDate || null,
      employmentStatus: u.employmentStatus || "PROBATION",
      probationSince: u.probationSince || null,
      createdAt: u.createdAt || null,
      hasTds: !!u.hasTds,
      profileImage: u.profileImage || null,
      reportingPerson: u.reportingPerson || null,
      reportingPersons: u.reportingPersons || [],
      isDeleted: !!u.isDeleted,
      isActive: u.isActive !== false,
    })),
  });
});

module.exports = router;
