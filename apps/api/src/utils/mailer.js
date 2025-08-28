const nodemailer = require('nodemailer');

let _transporter = null;

function createTransporter() {
  const {
    SMTP_HOST,
    SMTP_PORT,
    SMTP_SECURE,
    SMTP_USER,
    SMTP_PASS,
    SMTP_FROM,
  } = process.env;

  if (!SMTP_HOST) {
    console.warn('[mailer] SMTP not configured (missing SMTP_HOST). Emails will be skipped.');
    return null;
  }

  const port = SMTP_PORT ? parseInt(SMTP_PORT, 10) : 587;
  const secure = String(SMTP_SECURE || '').toLowerCase() === 'true' || port === 465;

  // Some providers (e.g., Gmail app passwords) are shown with spaces; strip them.
  const sanitizedPass = SMTP_PASS ? SMTP_PASS.replace(/\s+/g, '') : undefined;

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure,
    auth: SMTP_USER ? { user: SMTP_USER, pass: sanitizedPass } : undefined,
    logger: String(process.env.SMTP_DEBUG || '').toLowerCase() === 'true',
    debug: String(process.env.SMTP_DEBUG || '').toLowerCase() === 'true',
  });

  // Default From: use provided, else SMTP user. For Gmail, prefer SMTP_USER to avoid alias issues.
  const isGmail = String(SMTP_HOST || '').toLowerCase().includes('gmail');
  let defaultFrom = SMTP_FROM || SMTP_USER || undefined;
  if (isGmail && SMTP_USER) {
    // For Gmail, enforce the actual Gmail address, but preserve display name if provided
    if (SMTP_FROM) {
      const m = String(SMTP_FROM).match(/^([^<]+)</);
      const name = m ? m[1].trim() : null;
      defaultFrom = name ? `${name} <${SMTP_USER}>` : SMTP_USER;
    } else {
      defaultFrom = SMTP_USER;
    }
  }
  transporter._defaultFrom = defaultFrom;

  // Proactive verification (non-fatal): helps surface auth/connection errors at startup
  transporter.verify().then(() => {
    console.log(`[mailer] SMTP ready on ${SMTP_HOST}:${port} (secure=${secure})`);
  }).catch((e) => {
    console.warn('[mailer] SMTP verify failed:', e?.message || e);
  });
  return transporter;
}

function getTransporter() {
  if (_transporter === null) {
    _transporter = createTransporter();
  }
  return _transporter;
}

function isEmailEnabled() {
  return !!getTransporter();
}

/**
 * Send an email via SMTP.
 * @param {Object} opts
 * @param {string|string[]} opts.to - Recipient(s)
 * @param {string} opts.subject - Subject line
 * @param {string} [opts.text] - Plain text content
 * @param {string} [opts.html] - HTML content
 * @param {string|string[]} [opts.cc]
 * @param {string|string[]} [opts.bcc]
 * @param {string} [opts.from]
 * @param {Array} [opts.attachments]
 * @returns {Promise<object>} nodemailer sendMail info
 */
async function sendMail(opts) {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn('[mailer] Email skipped: transporter not available');
    return { skipped: true };
  }

  let from = opts.from || transporter._defaultFrom;
  if (!from) {
    console.warn('[mailer] Email skipped: missing FROM address (set SMTP_FROM or SMTP_USER)');
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
  };

  return transporter.sendMail(mailOptions);
}

module.exports = { sendMail, isEmailEnabled };
