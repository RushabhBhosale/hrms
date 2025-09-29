const nodemailer = require('nodemailer');
const Company = require('../models/Company');

let _defaultTransporter = undefined;
const companyTransporters = new Map();

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  }
  return fallback;
}

function sanitizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildTransportOptions(config = {}) {
  const host = sanitizeString(config.host);
  if (!host) return null;

  const portRaw = config.port !== undefined ? config.port : undefined;
  const portParsed = parseInt(portRaw, 10);
  const port = Number.isFinite(portParsed) && portParsed > 0 ? portParsed : 587;

  let secure = config.secure;
  if (secure === undefined || secure === null || secure === '') {
    secure = port === 465;
  } else {
    secure = parseBoolean(secure, port === 465);
  }

  const user = sanitizeString(config.user);
  let pass = config.pass;
  if (typeof pass === 'string') {
    pass = pass.trim().replace(/\s+/g, '');
  } else if (!pass) {
    pass = undefined;
  }

  const debug = parseBoolean(config.debug);

  const options = {
    host,
    port,
    secure,
    logger: debug,
    debug,
  };

  if (user) {
    options.auth = { user, pass };
  }

  return options;
}

function computeDefaultFrom(config = {}, user) {
  let from = sanitizeString(config.from);
  const host = sanitizeString(config.host).toLowerCase();

  if (!from && user) {
    from = user;
  }

  if (host.includes('gmail') && user) {
    if (from) {
      const match = from.match(/^([^<]+)</);
      const name = match ? match[1].trim() : null;
      from = name ? `${name} <${user}>` : user;
    } else {
      from = user;
    }
  }

  return from;
}

function createTransporterFromConfig(config = {}, { label } = {}) {
  const options = buildTransportOptions(config);
  if (!options) return null;

  const transporter = nodemailer.createTransport(options);
  transporter._defaultFrom = computeDefaultFrom(config, options.auth?.user);
  transporter._defaultReplyTo = sanitizeString(config.replyTo) || undefined;
  transporter._label = label || 'default';

  transporter
    .verify()
    .then(() => {
      console.log(
        `[mailer] SMTP ready (${transporter._label}) on ${options.host}:${options.port} (secure=${options.secure})`
      );
    })
    .catch((err) => {
      console.warn(
        `[mailer] SMTP verify failed (${transporter._label}):`,
        err?.message || err
      );
    });

  return transporter;
}

function createDefaultTransporter() {
  const {
    SMTP_HOST,
    SMTP_PORT,
    SMTP_SECURE,
    SMTP_USER,
    SMTP_PASS,
    SMTP_FROM,
    SMTP_REPLY_TO,
    SMTP_DEBUG,
  } = process.env;

  if (!SMTP_HOST) {
    console.warn('[mailer] SMTP not configured (missing SMTP_HOST). Emails will be skipped.');
    return null;
  }

  return createTransporterFromConfig(
    {
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      user: SMTP_USER,
      pass: SMTP_PASS,
      from: SMTP_FROM,
      replyTo: SMTP_REPLY_TO,
      debug: SMTP_DEBUG,
    },
    { label: 'default' }
  );
}

function getDefaultTransporter() {
  if (_defaultTransporter === undefined) {
    _defaultTransporter = createDefaultTransporter();
  }
  return _defaultTransporter;
}

async function getCompanyTransporter(companyId) {
  if (!companyId) return null;
  const key = String(companyId);
  if (companyTransporters.has(key)) {
    return companyTransporters.get(key);
  }

  let company;
  try {
    company = await Company.findById(key).select('smtp').lean();
  } catch (err) {
    console.warn('[mailer] Failed to load company for SMTP:', err?.message || err);
    companyTransporters.set(key, null);
    return null;
  }

  const smtp = company?.smtp;
  if (!smtp || !smtp.enabled || !sanitizeString(smtp.host)) {
    companyTransporters.set(key, null);
    return null;
  }

  const transporter = createTransporterFromConfig(
    {
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      user: smtp.user,
      pass: smtp.pass,
      from: smtp.from,
      replyTo: smtp.replyTo,
    },
    { label: `company:${key}` }
  );

  if (!transporter) {
    companyTransporters.set(key, null);
    return null;
  }

  companyTransporters.set(key, transporter);
  return transporter;
}

async function resolveTransporter(companyId) {
  const companyTransporter = await getCompanyTransporter(companyId);
  if (companyTransporter) return companyTransporter;
  return getDefaultTransporter();
}

async function sendMail(opts) {
  const transporter = await resolveTransporter(opts.companyId);
  if (!transporter) {
    console.warn('[mailer] Email skipped: transporter not available');
    return { skipped: true };
  }

  let from = opts.from || transporter._defaultFrom;
  if (!from) {
    console.warn('[mailer] Email skipped: missing FROM address');
    return { skipped: true };
  }

  const mailOptions = {
    from,
    to: opts.to,
    cc: opts.cc,
    bcc: opts.bcc,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
    attachments: opts.attachments,
    replyTo: opts.replyTo || transporter._defaultReplyTo,
  };

  return transporter.sendMail(mailOptions);
}

async function isEmailEnabled(companyId) {
  const transporter = await resolveTransporter(companyId);
  return !!transporter;
}

function invalidateCompanyTransporter(companyId) {
  if (!companyId) return;
  const key = String(companyId);
  const cached = companyTransporters.get(key);
  if (cached && typeof cached.close === 'function') {
    try {
      cached.close();
    } catch (_) {}
  }
  companyTransporters.delete(key);
}

async function testSMTPConnection(config = {}) {
  const options = buildTransportOptions(config);
  if (!options) {
    throw new Error('SMTP host is required');
  }
  const transporter = nodemailer.createTransport(options);
  try {
    await transporter.verify();
  } finally {
    if (typeof transporter.close === 'function') transporter.close();
  }
}

module.exports = {
  sendMail,
  isEmailEnabled,
  invalidateCompanyTransporter,
  testSMTPConnection,
};
