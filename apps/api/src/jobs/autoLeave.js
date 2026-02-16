const cron = require("node-cron");
const Employee = require("../models/Employee");
const attendanceRoutes = require("../routes/attendance");

const DEFAULT_LOOKBACK_DAYS = 2;
const DEFAULT_CRON = process.env.AUTO_LEAVE_CRON || "30 0 * * *";

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

async function runAutoLeaveJob(options = {}) {
  const collectAttendanceIssues = attendanceRoutes.collectAttendanceIssues;
  if (typeof collectAttendanceIssues !== "function") {
    console.warn(
      "[auto-leave] collectAttendanceIssues unavailable, skipping run"
    );
    return;
  }

  const rawLookback =
    options.lookbackDays ??
    process.env.AUTO_LEAVE_LOOKBACK_DAYS ??
    DEFAULT_LOOKBACK_DAYS;
  const parsedLookback = Number(rawLookback);
  const lookbackDays = Math.max(
    1,
    Number.isFinite(parsedLookback) && parsedLookback > 0
      ? parsedLookback
      : DEFAULT_LOOKBACK_DAYS
  );
  const todayStart = startOfDay(new Date());
  const windowStart = new Date(todayStart);
  windowStart.setDate(windowStart.getDate() - lookbackDays);

  const employees = await Employee.find({
    company: { $exists: true },
    primaryRole: "EMPLOYEE",
  }).select("_id company joiningDate attendanceStartDate");

  for (const emp of employees) {
    try { emp?.decryptFieldsSync?.(); } catch (_) {}
  }

  if (!employees.length) {
    console.log("[auto-leave] no employees found");
    return;
  }

  console.log(
    `[auto-leave] running for ${employees.length} employees ` +
      `(lookback ${lookbackDays} days from ${windowStart.toISOString()} to ${todayStart.toISOString()})`
  );

  for (const emp of employees) {
    try {
      await collectAttendanceIssues({
        employeeId: emp._id,
        start: new Date(windowStart),
        endExclusive: todayStart,
        employeeDoc: emp,
      });
    } catch (err) {
      console.error(
        `[auto-leave] employee=${emp._id} failed`,
        err?.message || err
      );
    }
  }
}

function scheduleAutoLeaveJob() {
  if (process.env.DISABLE_AUTO_LEAVE_JOB === "1") {
    console.log("[auto-leave] job disabled via DISABLE_AUTO_LEAVE_JOB");
    return;
  }
  cron.schedule(
    DEFAULT_CRON,
    () => {
      runAutoLeaveJob().catch((err) =>
        console.error("[auto-leave] scheduled run failed", err?.message || err)
      );
    },
    {
      scheduled: true,
      timezone: "Asia/Kolkata",
    }
  );
  runAutoLeaveJob().catch((err) =>
    console.error("[auto-leave] initial run failed", err?.message || err)
  );
}

module.exports = {
  runAutoLeaveJob,
  scheduleAutoLeaveJob,
};
