"use strict";

const router = require("express").Router();
const Leave = require("../models/Leave");
const Employee = require("../models/Employee");
const Company = require("../models/Company");
const { auth } = require("../middleware/auth");
const { requirePrimary } = require("../middleware/roles");
const CompanyDayOverride = require("../models/CompanyDayOverride");
const { sendMail, isEmailEnabled } = require("../utils/mailer");
const { accrueTotalIfNeeded } = require("../utils/leaveBalances");

/* ------------------------------ Utils ----------------------------------- */

function startOfDay(d) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}
function toIsoDay(date) {
  return startOfDay(date).toISOString().slice(0, 10);
}
function ymKey(date) {
  const d = new Date(date);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}
function computeChargeableDays(start, end, bankHolidayKeys) {
  const s = startOfDay(start),
    e = startOfDay(end);
  let n = 0,
    c = new Date(s);
  while (c <= e) {
    const dow = c.getUTCDay();
    const iso = toIsoDay(c);
    if (dow !== 0 && dow !== 6 && !bankHolidayKeys.has(iso)) n++;
    c.setUTCDate(c.getUTCDate() + 1);
  }
  return n;
}

function computeDerivedBalances(caps, used) {
  const c = caps || {};
  const u = used || { paid: 0, casual: 0, sick: 0, unpaid: 0 };
  return {
    paid: Math.max(0, (Number(c.paid) || 0) - (Number(u.paid) || 0)),
    casual: Math.max(0, (Number(c.casual) || 0) - (Number(u.casual) || 0)),
    sick: Math.max(0, (Number(c.sick) || 0) - (Number(u.sick) || 0)),
    unpaid: Number(u.unpaid) || 0,
  };
}

/* ----------------------- Accrual (with strong logs) ---------------------- */

async function ensureAccruedForMonth(empId, company, targetDate) {
  const employee = await Employee.findById(empId);
  if (!employee) return;
  await accrueTotalIfNeeded(employee, company, targetDate || new Date());
}

/* ------------------------------- Create --------------------------------- */

router.post("/", auth, async (req, res) => {
  const { startDate, endDate, reason, type, fallbackType, notify } = req.body;
  try {
    const emp = await Employee.findById(req.employee.id);
    if (!emp) return res.status(400).json({ error: "Employee not found" });
    if (!type) return res.status(400).json({ error: "Missing type" });
    if (
      fallbackType &&
      !["PAID", "SICK", "UNPAID", "CASUAL"].includes(fallbackType)
    )
      return res.status(400).json({ error: "Invalid fallback type" });

    const reportingIds = Array.from(
      new Set(
        [
          ...(Array.isArray(emp.reportingPersons)
            ? emp.reportingPersons.map((id) => String(id))
            : []),
          emp.reportingPerson ? String(emp.reportingPerson) : null,
        ].filter(Boolean)
      )
    );

    const leave = await Leave.create({
      employee: emp._id,
      company: emp.company,
      approver: reportingIds[0] || null,
      type,
      fallbackType: fallbackType || null,
      startDate,
      endDate,
      reason,
      status: "PENDING",
    });
    res.json({ leave });

    // async emails (unchanged, trimmed)
    (async () => {
      const companyId = emp.company;
      if (!(await isEmailEnabled(companyId))) return;
      try {
        const [reportingMembers, company] = await Promise.all([
          reportingIds.length
            ? Employee.find({ _id: { $in: reportingIds } }).select(
                "name email"
              )
            : [],
          Company.findById(emp.company).populate("admin", "name email"),
        ]);
        const recipients = new Set();
        for (const member of reportingMembers) {
          if (member?.email) recipients.add(member.email);
        }
        if (company?.admin?.email) recipients.add(company.admin.email);
        if (Array.isArray(notify)) {
          const ids = notify.map(String).filter((x) => x && x.length >= 12);
          if (ids.length) {
            const extras = await Employee.find({
              _id: { $in: ids },
              company: emp.company,
            }).select("email");
            for (const u of extras) if (u?.email) recipients.add(u.email);
          }
        }
        if (!recipients.size) return;
        const fmt = (d) => new Date(d).toISOString().slice(0, 10);
        await sendMail({
          companyId,
          to: Array.from(recipients),
          subject: `New Leave Request: ${emp.name} (${type}) ${fmt(
            startDate
          )} → ${fmt(endDate)}`,
          text: `New leave by ${emp.name} (${type}) ${fmt(startDate)} to ${fmt(
            endDate
          )}${reason ? `\nReason: ${reason}` : ""}`,
          html: `<div style="font-family:system-ui;line-height:1.5">
                  <h2 style="margin:0 0 12px">New Leave Request</h2>
                  <p><strong>Employee:</strong> ${emp.name} &lt;${
            emp.email
          }&gt;</p>
                  <p><strong>Type:</strong> ${type}</p>
                  <p><strong>Period:</strong> ${fmt(startDate)} to ${fmt(
            endDate
          )}</p>
                  ${
                    reason
                      ? `<p><strong>Reason:</strong> ${String(reason).replace(
                          /</g,
                          "&lt;"
                        )}</p>`
                      : ""
                  }
                  <p style="color:#666;font-size:12px">Automated email from HRMS</p>
                 </div>`,
        });
      } catch (e) {
        console.warn("[leaves] mail fail:", e?.message || e);
      }
    })();
  } catch (e) {
    res.status(400).json({ error: e?.message || "Failed to create leave" });
  }
});

/* ------------------------------- Lists ---------------------------------- */

router.get("/", auth, async (req, res) => {
  const leaves = await Leave.find({ employee: req.employee.id })
    .sort({ createdAt: -1 })
    .lean();
  res.json({ leaves });
});

router.get("/assigned", auth, async (req, res) => {
  const leaves = await Leave.find({ approver: req.employee.id })
    .populate("employee", "name")
    .sort({ createdAt: -1 })
    .lean();
  res.json({ leaves });
});

router.get(
  "/company",
  auth,
  requirePrimary(["ADMIN", "SUPERADMIN"]),
  async (req, res) => {
    const leaves = await Leave.find({ company: req.employee.company })
      .populate("employee", "name")
      .sort({ createdAt: -1 })
      .lean();
    res.json({ leaves });
  }
);

router.get("/company/today", auth, async (req, res) => {
  const allowed =
    ["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole) ||
    (req.employee.subRoles || []).some((r) => ["hr", "manager"].includes(r));
  if (!allowed) return res.status(403).json({ error: "Forbidden" });

  const today = startOfDay(new Date());
  const leaves = await Leave.find({
    company: req.employee.company,
    status: "APPROVED",
    startDate: { $lte: today },
    endDate: { $gte: today },
  })
    .populate("employee", "name")
    .lean();

  res.json({ leaves });
});

/* ------------------------------ Approve --------------------------------- */

router.post("/:id/approve", auth, async (req, res) => {
  const leave = await Leave.findById(req.params.id);
  if (!leave) return res.status(404).json({ error: "Not found" });

  const isAdmin = ["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole);
  if (String(leave.approver) !== String(req.employee.id) && !isAdmin)
    return res.status(403).json({ error: "Forbidden" });
  if (leave.status === "APPROVED")
    return res.status(409).json({ error: "Already approved" });
  if (leave.status === "REJECTED")
    return res.status(409).json({ error: "Already rejected" });

  const company = await Company.findById(leave.company).select(
    "bankHolidays leavePolicy"
  );

  // Accrue once for leave month
  await ensureAccruedForMonth(leave.employee, company, leave.startDate);

  // Re-read employee AFTER accrual
  const employee = await Employee.findById(leave.employee).select(
    "totalLeaveAvailable leaveUsage leaveBalances leaveAccrual.lastAccruedYearMonth"
  );

  console.log(
    "LEAVES: 📦 BEFORE APPROVAL employee snapshot:",
    JSON.stringify({
      totalLeaveAvailable: employee?.totalLeaveAvailable,
      leaveUsage: employee?.leaveUsage,
      lastAccruedYearMonth: employee?.leaveAccrual?.lastAccruedYearMonth,
    })
  );

  // 2) Build holiday set with overrides
  const start = startOfDay(leave.startDate);
  const end = startOfDay(leave.endDate);
  const bankHolidayKeys = new Set(
    (company?.bankHolidays || [])
      .map((h) => startOfDay(h.date))
      .filter((d) => d >= start && d <= end)
      .map((d) => toIsoDay(d))
  );
  const overrides = await CompanyDayOverride.find({
    company: leave.company,
    date: { $gte: start, $lte: end },
  })
    .select("date type")
    .lean();
  for (const o of overrides) {
    const k = toIsoDay(o.date);
    if (o.type === "WORKING") bankHolidayKeys.delete(k);
    if (o.type === "HOLIDAY") bankHolidayKeys.add(k);
  }
  const days = Math.max(computeChargeableDays(start, end, bankHolidayKeys), 0);
  console.log(`LEAVES: 🧮 Chargeable days (excl weekends/holidays): ${days}`);

  // 3) Allocate against caps and pool
  const caps = company?.leavePolicy?.typeCaps || {};
  const usedPrev = employee.leaveUsage || {
    paid: 0,
    casual: 0,
    sick: 0,
    unpaid: 0,
  };
  const allocations = { paid: 0, casual: 0, sick: 0, unpaid: 0 };
  const typeKey = String(leave.type || "").toLowerCase(); // 'paid'|'casual'|'sick'|'unpaid'

  if (typeKey === "unpaid") {
    allocations.unpaid = days;
  } else {
    const poolNow = Math.max(0, Number(employee.totalLeaveAvailable) || 0);
    const capForType = Math.max(0, Number(caps[typeKey]) || 0);
    const usedForType = Math.max(0, Number(usedPrev[typeKey]) || 0);
    const remainType = Math.max(0, capForType - usedForType);

    const firstPart = Math.max(
      0,
      Math.min(days, Math.min(remainType, poolNow))
    );
    if (firstPart > 0) allocations[typeKey] = firstPart;

    let remaining = Math.max(0, days - firstPart);
    if (remaining > 0) {
      const fb = String(leave.fallbackType || "").toLowerCase();
      if (!fb) {
        return res.status(400).json({
          error: `Insufficient ${typeKey} leaves. Choose fallback (Paid/Sick/Unpaid/Casual).`,
        });
      }

      if (fb === "unpaid") {
        allocations.unpaid += remaining;
        remaining = 0;
      } else if (["paid", "sick", "casual"].includes(fb)) {
        const capFb = Math.max(0, Number(caps[fb]) || 0);
        const usedFb = Math.max(0, Number(usedPrev[fb]) || 0);
        const remainFb = Math.max(0, capFb - usedFb);
        const poolLeftForFb = Math.max(0, poolNow - allocations[typeKey]);
        const useFb = Math.max(
          0,
          Math.min(remaining, Math.min(remainFb, poolLeftForFb))
        );
        if (useFb > 0) {
          allocations[fb] += useFb;
          remaining -= useFb;
        }
        if (remaining > 0) {
          allocations.unpaid += remaining;
          remaining = 0;
        }
      } else {
        return res.status(400).json({ error: "Invalid fallback type" });
      }
    }
  }

  console.log("LEAVES: 📦 Allocations decided:", allocations);

  // 4) Atomic: decrement pool, bump usage, set derived balances
  const poolDeduct =
    (allocations.paid || 0) +
    (allocations.casual || 0) +
    (allocations.sick || 0);

  const usedNext = {
    paid: (usedPrev.paid || 0) + (allocations.paid || 0),
    casual: (usedPrev.casual || 0) + (allocations.casual || 0),
    sick: (usedPrev.sick || 0) + (allocations.sick || 0),
    unpaid: (usedPrev.unpaid || 0) + (allocations.unpaid || 0),
  };
  const derived = computeDerivedBalances(caps, usedNext);

  console.log(
    `LEAVES: 🔻 Pool deduct=${poolDeduct}, BEFORE totalLeaveAvailable=${employee.totalLeaveAvailable}`
  );

  const updateRes = await Employee.updateOne(
    { _id: employee._id },
    {
      $inc: {
        totalLeaveAvailable: -poolDeduct,
        "leaveUsage.paid": allocations.paid || 0,
        "leaveUsage.casual": allocations.casual || 0,
        "leaveUsage.sick": allocations.sick || 0,
        "leaveUsage.unpaid": allocations.unpaid || 0,
      },
      $set: { leaveBalances: derived },
    }
  );

  console.log(
    `LEAVES: 🧾 Employee.updateOne result matched=${updateRes.matchedCount} modified=${updateRes.modifiedCount}`
  );

  const updatedEmp = await Employee.findById(employee._id).select(
    "totalLeaveAvailable leaveBalances leaveUsage leaveAccrual.lastAccruedYearMonth"
  );
  console.log(
    "LEAVES: 📦 AFTER APPROVAL SNAPSHOT:",
    JSON.stringify({
      totalLeaveAvailable: updatedEmp?.totalLeaveAvailable,
      leaveBalances: updatedEmp?.leaveBalances,
      leaveUsage: updatedEmp?.leaveUsage,
      lastAccruedYearMonth: updatedEmp?.leaveAccrual?.lastAccruedYearMonth,
    })
  );

  leave.status = "APPROVED";
  leave.adminMessage = req.body.message;
  leave.allocations = allocations;
  await leave.save();

  res.json({
    leave,
    employee: updatedEmp,
    debug: {
      monthAccruedFor: ymKey(leave.startDate),
      poolDeduct,
      poolAfter: updatedEmp?.totalLeaveAvailable,
    },
  });

  // async notification (trimmed)
  (async () => {
    try {
      const companyId = leave.company;
      if (!(await isEmailEnabled(companyId))) return;
      const emp = await Employee.findById(leave.employee).select("name email");
      if (!emp?.email) return;
      const fmt = (d) => new Date(d).toISOString().slice(0, 10);
      await sendMail({
        companyId,
        to: emp.email,
        subject: `Your leave was approved: ${fmt(leave.startDate)} → ${fmt(
          leave.endDate
        )}`,
        text: `Hi ${emp.name}, your leave was approved. ${fmt(
          leave.startDate
        )} → ${fmt(leave.endDate)}`,
        html: `<p>Hi ${
          emp.name
        },</p><p>Your leave was <strong>approved</strong>.</p>
               <p><strong>Period:</strong> ${fmt(leave.startDate)} to ${fmt(
          leave.endDate
        )}</p>
               <p style="color:#666;font-size:12px">Automated email from HRMS</p>`,
      });
    } catch (e) {
      console.warn("[approve mail] fail:", e?.message || e);
    }
  })();
});

/* ------------------------------ Reject ---------------------------------- */

router.post("/:id/reject", auth, async (req, res) => {
  const leave = await Leave.findById(req.params.id);
  if (!leave) return res.status(404).json({ error: "Not found" });
  const isAdmin = ["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole);
  if (String(leave.approver) !== String(req.employee.id) && !isAdmin)
    return res.status(403).json({ error: "Forbidden" });
  if (leave.status === "APPROVED")
    return res.status(409).json({ error: "Already approved" });
  if (leave.status === "REJECTED")
    return res.status(409).json({ error: "Already rejected" });

  leave.status = "REJECTED";
  leave.adminMessage = req.body.message;
  await leave.save();
  res.json({ leave });

  (async () => {
    try {
      const companyId = leave.company;
      if (!(await isEmailEnabled(companyId))) return;
      const emp = await Employee.findById(leave.employee).select("name email");
      if (!emp?.email) return;
      const fmt = (d) => new Date(d).toISOString().slice(0, 10);
      await sendMail({
        companyId,
        to: emp.email,
        subject: `Your leave was rejected: ${fmt(leave.startDate)} → ${fmt(
          leave.endDate
        )}`,
        text: `Hi ${emp.name}, your leave was rejected. ${fmt(
          leave.startDate
        )} → ${fmt(leave.endDate)}${
          leave.adminMessage ? `\n\nMessage: ${leave.adminMessage}` : ""
        }`,
        html: `<p>Hi ${
          emp.name
        },</p><p>Your leave was <strong>rejected</strong>.</p>
               <p><strong>Period:</strong> ${fmt(leave.startDate)} to ${fmt(
          leave.endDate
        )}</p>
               ${
                 leave.adminMessage
                   ? `<p><strong>Message:</strong> ${String(
                       leave.adminMessage
                     ).replace(/</g, "&lt;")}</p>`
                   : ""
               }
               <p style="color:#666;font-size:12px">Automated email from HRMS</p>`,
      });
    } catch (e) {
      console.warn("[reject mail] fail:", e?.message || e);
    }
  })();
});

/* ------------------------------ Backfill -------------------------------- */

router.post(
  "/backfill",
  auth,
  requirePrimary(["ADMIN", "SUPERADMIN"]),
  async (req, res) => {
    try {
      const companyId = req.employee.company;
      const approve = req.body?.approve !== false;
      const rows = Array.isArray(req.body?.entries) ? req.body.entries : [];
      if (!rows.length)
        return res.status(400).json({ error: "No entries provided" });

      const company = await Company.findById(companyId).select(
        "bankHolidays leavePolicy"
      );
      const out = { created: 0, approved: 0, errors: [] };

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i] || {};
        try {
          let emp = null;
          if (r.employeeId) {
            emp = await Employee.findOne({
              _id: r.employeeId,
              company: companyId,
            });
          } else if (r.email) {
            emp = await Employee.findOne({
              email: r.email,
              company: companyId,
            });
          }
          if (!emp) throw new Error("Employee not found in company");
          if (!r.type) throw new Error("Missing type");

          const leave = await Leave.create({
            employee: emp._id,
            company: companyId,
            approver: req.employee.id,
            type: r.type,
            fallbackType: r.fallbackType || null,
            startDate: r.startDate,
            endDate: r.endDate,
            reason: r.reason || "Backfill import",
            status: "PENDING",
          });
          out.created += 1;

          if (approve) {
            // NOTE: We purposely don’t do accrual here for every backfill; if needed,
            // you can call ensureAccruedForMonth(leave.employee, company, leave.startDate);

            const employee = await Employee.findById(leave.employee).select(
              "totalLeaveAvailable leaveUsage"
            );

            const start = startOfDay(leave.startDate);
            const end = startOfDay(leave.endDate);
            const bankHolidayKeys = new Set(
              (company?.bankHolidays || [])
                .map((h) => startOfDay(h.date))
                .filter((d) => d >= start && d <= end)
                .map((d) => toIsoDay(d))
            );
            const overrides = await CompanyDayOverride.find({
              company: leave.company,
              date: { $gte: start, $lte: end },
            })
              .select("date type")
              .lean();

            for (const o of overrides) {
              const k = toIsoDay(o.date);
              if (o.type === "WORKING") bankHolidayKeys.delete(k);
              if (o.type === "HOLIDAY") bankHolidayKeys.add(k);
            }
            const days = Math.max(
              computeChargeableDays(start, end, bankHolidayKeys),
              0
            );

            const caps = company?.leavePolicy?.typeCaps || {};
            const usedPrev = employee.leaveUsage || {
              paid: 0,
              casual: 0,
              sick: 0,
              unpaid: 0,
            };
            const allocations = { paid: 0, casual: 0, sick: 0, unpaid: 0 };
            const typeKey = String(leave.type || "").toLowerCase();

            if (typeKey === "unpaid") {
              allocations.unpaid = days;
            } else {
              const poolNow = Math.max(
                0,
                Number(employee.totalLeaveAvailable) || 0
              );
              const capForType = Math.max(0, Number(caps[typeKey]) || 0);
              const usedForType = Math.max(0, Number(usedPrev[typeKey]) || 0);
              const remainType = Math.max(0, capForType - usedForType);

              const firstPart = Math.max(
                0,
                Math.min(days, Math.min(remainType, poolNow))
              );
              if (firstPart > 0) allocations[typeKey] = firstPart;

              let remaining = Math.max(0, days - firstPart);
              if (remaining > 0) {
                const fb = String(leave.fallbackType || "").toLowerCase();
                if (!fb)
                  throw new Error(
                    `Insufficient ${typeKey} leave. Missing fallbackType`
                  );
                if (fb === "unpaid") {
                  allocations.unpaid += remaining;
                  remaining = 0;
                } else if (["paid", "sick", "casual"].includes(fb)) {
                  const capFb = Math.max(0, Number(caps[fb]) || 0);
                  const usedFb = Math.max(0, Number(usedPrev[fb]) || 0);
                  const remainFb = Math.max(0, capFb - usedFb);
                  const poolLeftForFb = Math.max(
                    0,
                    poolNow - allocations[typeKey]
                  );
                  const useFb = Math.max(
                    0,
                    Math.min(remaining, Math.min(remainFb, poolLeftForFb))
                  );
                  if (useFb > 0) {
                    allocations[fb] += useFb;
                    remaining -= useFb;
                  }
                  if (remaining > 0) {
                    allocations.unpaid += remaining;
                    remaining = 0;
                  }
                } else {
                  throw new Error("Invalid fallbackType");
                }
              }
            }

            const poolDeduct =
              (allocations.paid || 0) +
              (allocations.casual || 0) +
              (allocations.sick || 0);

            const usedNext = {
              paid: (usedPrev.paid || 0) + (allocations.paid || 0),
              casual: (usedPrev.casual || 0) + (allocations.casual || 0),
              sick: (usedPrev.sick || 0) + (allocations.sick || 0),
              unpaid: (usedPrev.unpaid || 0) + (allocations.unpaid || 0),
            };
            const derived = computeDerivedBalances(caps, usedNext);

            await Employee.updateOne(
              { _id: leave.employee },
              {
                $inc: {
                  totalLeaveAvailable: -poolDeduct,
                  "leaveUsage.paid": allocations.paid || 0,
                  "leaveUsage.casual": allocations.casual || 0,
                  "leaveUsage.sick": allocations.sick || 0,
                  "leaveUsage.unpaid": allocations.unpaid || 0,
                },
                $set: { leaveBalances: derived },
              }
            );

            leave.status = "APPROVED";
            leave.allocations = allocations;
            await leave.save();

            out.approved += 1;
          }
        } catch (e) {
          out.errors.push({ index: i, error: e?.message || String(e) });
        }
      }

      res.json(out);
    } catch (e) {
      res
        .status(400)
        .json({ error: e?.message || "Failed to backfill leaves" });
    }
  }
);

module.exports = router;
