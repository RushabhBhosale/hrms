const router = require("express").Router();
const mongoose = require("mongoose");
const PDFDocument = require("pdfkit");
const { auth } = require("../middleware/auth");
const Company = require("../models/Company");
const OnboardingCandidate = require("../models/OnboardingCandidate");
const { ONBOARDING_STATUSES } = OnboardingCandidate;
const { isValidEmail } = require("../utils/validate");
const { sendMail, isEmailEnabled } = require("../utils/mailer");
const { loadFileBuffer } = require("../utils/fileStorage");

function success(res, message, payload = {}) {
  if (message) res.set("X-Success-Message", message);
  return res.json({ message, ...payload });
}

function parseBooleanInput(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function canManage(req) {
  const primary = req.employee?.primaryRole;
  if (primary === "ADMIN" || primary === "SUPERADMIN") return true;
  const subs = req.employee?.subRoles || [];
  return subs.includes("hr");
}

async function resolveCompany(req) {
  if (["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole)) {
    const company = await Company.findOne({ admin: req.employee.id });
    if (company) return company;
  }
  if (req.employee.company) {
    const company = await Company.findById(req.employee.company);
    if (company) return company;
  }
  return null;
}

function normalizeStatus(value, fallback = "INTERVIEW") {
  if (typeof value !== "string") return fallback;
  const upper = value.trim().toUpperCase();
  return ONBOARDING_STATUSES.includes(upper) ? upper : fallback;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function mapCandidate(doc) {
  const obj = doc?.toObject ? doc.toObject() : doc;
  return {
    id: obj._id,
    name: obj.name,
    email: obj.email,
    status: obj.status || "INTERVIEW",
    notes: obj.notes || "",
    lastEmailSubject: obj.lastEmailSubject || "",
    lastEmailBody: obj.lastEmailBody || "",
    lastEmailSentAt: obj.lastEmailSentAt || null,
    createdAt: obj.createdAt || null,
    updatedAt: obj.updatedAt || null,
  };
}

async function ensureEmailReady(companyId) {
  const enabled = await isEmailEnabled(companyId);
  if (!enabled) {
    const err = new Error("Email is not configured for this company");
    err.statusCode = 400;
    throw err;
  }
}

function safeFilename(name) {
  return String(name || "offer-letter").replace(/[^a-z0-9\-_.]+/gi, "_");
}

function formatOfferDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

async function buildOfferLetterAttachment({
  company,
  candidate,
  subject,
  body,
  offerPosition,
  offerStartDate,
  offerCompensation,
}) {
  const doc = new PDFDocument({ margin: 50 });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on("end", resolve));

  const logoBuffer = await loadFileBuffer(
    company?.logoHorizontal || company?.logo || company?.logoSquare
  );

  if (logoBuffer) {
    doc.image(logoBuffer, 50, 40, { fit: [140, 80] });
    doc.moveDown(3);
  }

  doc
    .fontSize(20)
    .fillColor("#111")
    .text(subject || "Offer Letter", { align: "left" });
  doc.moveDown(1);

  const companyName = company?.name || "Our Team";
  doc
    .fontSize(12)
    .fillColor("#333")
    .text(`Company: ${companyName}`)
    .moveDown(0.3)
    .text(`Candidate: ${candidate?.name || ""} <${candidate?.email || ""}>`);

  if (offerPosition || offerStartDate || offerCompensation) {
    doc.moveDown(0.8);
    doc.fontSize(12).fillColor("#000").text("Offer Details", { underline: true });
    doc.moveDown(0.4);
    if (offerPosition) doc.text(`Role: ${offerPosition}`);
    if (offerStartDate) doc.text(`Start Date: ${formatOfferDate(offerStartDate)}`);
    if (offerCompensation) doc.text(`Compensation: ${offerCompensation}`);
  }

  const paragraphText = String(body || "").split(/\n{2,}/);
  doc.moveDown(0.8);
  doc.fontSize(12).fillColor("#111");
  paragraphText.forEach((p) => {
    if (!p.trim()) return;
    doc.text(p.trim(), { align: "left" });
    doc.moveDown(0.6);
  });

  doc.moveDown(1);
  doc.text(`Sincerely,\n${companyName}`);
  doc.end();
  await done;

  return {
    filename: `OfferLetter-${safeFilename(candidate?.name)}.pdf`,
    content: Buffer.concat(chunks),
  };
}

async function sendCandidateEmail({
  candidate,
  company,
  subject,
  body,
  actor,
  attachments,
}) {
  const companyName = company?.name || "our team";
  const actorName = actor?.name || "HR";
  const cleanBody = String(body || "").trim();
  const textSignature = `\n\nSent by ${actorName}${companyName ? ` — ${companyName}` : ""}`;
  const paragraphs = escapeHtml(cleanBody)
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, "<br>"))
    .filter(Boolean);

  const html = `<div>${paragraphs
    .map((p) => `<p style="margin:0 0 12px 0;">${p}</p>`)
    .join("")}<p style="color:#666;font-size:12px;">Sent by ${escapeHtml(
    actorName
  )}${companyName ? ` — ${escapeHtml(companyName)}` : ""}</p></div>`;

  await ensureEmailReady(company?._id);
  await sendMail({
    companyId: company?._id || null,
    to: candidate.email,
    subject,
    text: cleanBody + textSignature,
    html,
    attachments,
    skipInAppNotification: true,
  });

  candidate.lastEmailSubject = subject;
  candidate.lastEmailBody = cleanBody;
  candidate.lastEmailSentAt = new Date();
  candidate.lastEmailedBy = actor?.id || actor?._id || null;
}

router.get("/candidates", auth, async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: "Forbidden" });
  const company = await resolveCompany(req);
  if (!company) return res.status(400).json({ error: "Company not found" });

  const docs = await OnboardingCandidate.find({
    company: company._id,
    isDeleted: { $ne: true },
  }).sort({ updatedAt: -1, createdAt: -1 });

  res.json({ candidates: docs.map(mapCandidate) });
});

router.post("/candidates", auth, async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: "Forbidden" });
  const company = await resolveCompany(req);
  if (!company) return res.status(400).json({ error: "Company not found" });

  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const emailRaw =
    typeof req.body?.email === "string" ? req.body.email.trim() : "";
  const email = emailRaw.toLowerCase();
  const status = normalizeStatus(req.body?.status, "INTERVIEW");
  const notes =
    typeof req.body?.notes === "string" ? req.body.notes.trim() : "";
  const sendEmailFlag = parseBooleanInput(req.body?.sendEmail, false);
  const emailSubject =
    typeof req.body?.emailSubject === "string"
      ? req.body.emailSubject.trim()
      : "";
  const emailBody =
    typeof req.body?.emailBody === "string" ? req.body.emailBody.trim() : "";
  const includeOfferPdf = parseBooleanInput(req.body?.includeOfferPdf, false);
  const offerPosition =
    typeof req.body?.offerPosition === "string"
      ? req.body.offerPosition.trim()
      : "";
  const offerStartDate =
    typeof req.body?.offerStartDate === "string"
      ? req.body.offerStartDate.trim()
      : "";
  const offerCompensation =
    typeof req.body?.offerCompensation === "string"
      ? req.body.offerCompensation.trim()
      : "";

  if (!name || !email) {
    return res.status(400).json({ error: "Name and email are required" });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "Invalid email address" });
  }
  if (sendEmailFlag && (!emailSubject || !emailBody)) {
    return res
      .status(400)
      .json({ error: "Subject and message are required to send an email" });
  }

  const existing = await OnboardingCandidate.findOne({
    company: company._id,
    email,
    isDeleted: { $ne: true },
  });
  if (existing) {
    return res.status(400).json({ error: "Candidate already exists" });
  }

  const candidate = new OnboardingCandidate({
    company: company._id,
    name,
    email,
    status,
    notes,
    createdBy: req.employee.id,
    updatedBy: req.employee.id,
  });

  if (sendEmailFlag) {
    try {
      let attachments;
      if (includeOfferPdf) {
        attachments = [
          await buildOfferLetterAttachment({
            company,
            candidate,
            subject: emailSubject || "Offer Letter",
            body: emailBody,
            offerPosition,
            offerStartDate,
            offerCompensation,
          }),
        ];
      }
      await sendCandidateEmail({
        candidate,
        company,
        subject: emailSubject,
        body: emailBody,
        actor: req.employee,
        attachments,
      });
    } catch (err) {
      return res
        .status(err?.statusCode || 500)
        .json({ error: err?.message || "Failed to send email" });
    }
  }

  await candidate.save();
  return success(res, "Candidate saved", { candidate: mapCandidate(candidate) });
});

router.put("/candidates/:id", auth, async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: "Forbidden" });
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: "Invalid candidate id" });
  }
  const company = await resolveCompany(req);
  if (!company) return res.status(400).json({ error: "Company not found" });

  const candidate = await OnboardingCandidate.findOne({
    _id: id,
    company: company._id,
    isDeleted: { $ne: true },
  });
  if (!candidate) return res.status(404).json({ error: "Candidate not found" });

  const name =
    typeof req.body?.name === "string"
      ? req.body.name.trim()
      : candidate.name || "";
  const emailInput =
    typeof req.body?.email === "string"
      ? req.body.email.trim().toLowerCase()
      : candidate.email;
  const nextStatus = normalizeStatus(req.body?.status, candidate.status);
  const notes =
    typeof req.body?.notes === "string"
      ? req.body.notes.trim()
      : candidate.notes || "";

  if (!name || !emailInput) {
    return res.status(400).json({ error: "Name and email are required" });
  }
  if (!isValidEmail(emailInput)) {
    return res.status(400).json({ error: "Invalid email address" });
  }
  if (emailInput !== candidate.email) {
    const dup = await OnboardingCandidate.findOne({
      company: company._id,
      email: emailInput,
      _id: { $ne: candidate._id },
      isDeleted: { $ne: true },
    });
    if (dup) {
      return res
        .status(400)
        .json({ error: "Another candidate already uses that email" });
    }
  }

  candidate.name = name;
  candidate.email = emailInput;
  candidate.status = nextStatus;
  candidate.notes = notes;
  candidate.updatedBy = req.employee.id;

  await candidate.save();
  return success(res, "Candidate updated", { candidate: mapCandidate(candidate) });
});

router.post("/candidates/:id/send-email", auth, async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: "Forbidden" });
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: "Invalid candidate id" });
  }
  const company = await resolveCompany(req);
  if (!company) return res.status(400).json({ error: "Company not found" });

  const candidate = await OnboardingCandidate.findOne({
    _id: id,
    company: company._id,
    isDeleted: { $ne: true },
  });
  if (!candidate) return res.status(404).json({ error: "Candidate not found" });

  const subject =
    typeof req.body?.subject === "string" ? req.body.subject.trim() : "";
  const body =
    typeof req.body?.body === "string" ? req.body.body.trim() : "";
  const nextStatus = normalizeStatus(req.body?.status, candidate.status);
  const includeOfferPdf = parseBooleanInput(req.body?.includeOfferPdf, false);
  const offerPosition =
    typeof req.body?.offerPosition === "string"
      ? req.body.offerPosition.trim()
      : "";
  const offerStartDate =
    typeof req.body?.offerStartDate === "string"
      ? req.body.offerStartDate.trim()
      : "";
  const offerCompensation =
    typeof req.body?.offerCompensation === "string"
      ? req.body.offerCompensation.trim()
      : "";

  if (!subject || !body) {
    return res
      .status(400)
      .json({ error: "Subject and message are required" });
  }

  try {
    let attachments;
    if (includeOfferPdf) {
      attachments = [
        await buildOfferLetterAttachment({
          company,
          candidate,
          subject: subject || "Offer Letter",
          body,
          offerPosition,
          offerStartDate,
          offerCompensation,
        }),
      ];
    }
    await sendCandidateEmail({
      candidate,
      company,
      subject,
      body,
      actor: req.employee,
      attachments,
    });
    candidate.status = nextStatus;
    candidate.updatedBy = req.employee.id;
    await candidate.save();
  } catch (err) {
    return res
      .status(err?.statusCode || 500)
      .json({ error: err?.message || "Failed to send email" });
  }

  return success(res, "Email sent", { candidate: mapCandidate(candidate) });
});

module.exports = router;
