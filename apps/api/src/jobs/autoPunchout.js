const cron = require("node-cron");
const Attendance = require("../models/Attendance");

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

async function runAutoPunchOut() {
  try {
    const now = new Date();
    const todayStart = startOfDay(now);

    // 🔹 Find all previous-day (and older) records with an open punch-in
    const records = await Attendance.find({
      date: { $lt: todayStart },
      lastPunchIn: { $exists: true, $ne: null },
    });

    console.log(
      `[auto-punchout] ${now.toISOString()} — candidates: ${records.length}`
    );
    if (!records.length) return { candidates: 0, closed: 0 };

    let closed = 0;
    for (const rec of records) {
      const openStart = rec.lastPunchIn || rec.firstPunchIn;
      if (!openStart) continue;

      const lastIn = new Date(openStart);

      const workdayStart = startOfDay(rec.date);
      const workdayEnd = new Date(workdayStart);
      workdayEnd.setDate(workdayEnd.getDate() + 1);

      const lastInMs = lastIn.getTime();
      const dayEndMs = workdayEnd.getTime();

      let autoOutMs = Math.min(now.getTime(), dayEndMs);
      if (autoOutMs <= lastInMs) {
        autoOutMs = Math.min(
          now.getTime(),
          Math.max(lastInMs + 60000, dayEndMs)
        );
      }
      if (autoOutMs <= lastInMs) {
        autoOutMs = lastInMs + 60000;
      }
      if (autoOutMs <= lastInMs) continue;

      const autoOut = new Date(autoOutMs);

      const addMs = autoOut.getTime() - lastInMs;
      rec.workedMs = (rec.workedMs || 0) + addMs;
      rec.lastPunchOut = autoOut;
      rec.lastPunchIn = undefined;
      rec.autoPunchOut = true;
      rec.autoPunchOutAt = autoOut;
      rec.autoPunchLastIn = openStart;
      rec.autoPunchResolvedAt = undefined;
      await rec.save();
      closed++;

      console.log(
        `[auto-punchout] closed employee=${
          rec.employee
        } date=${workdayStart.toISOString()} autoOut=${autoOut.toISOString()} +${Math.round(addMs / 60000)}m`
      );
    }

    return { candidates: records.length, closed };
  } catch (e) {
    console.error("[auto-punchout] Failed to run job:", e?.message || e);
    return { candidates: 0, closed: 0, error: String(e?.message || e) };
  }
}

function scheduleAutoPunchOut() {
  // Default: run daily at 00:01 IST, configurable via env AUTO_PUNCHOUT_CRON
  const cronExpr = process.env.AUTO_PUNCHOUT_CRON || "1 0 * * *";
  cron.schedule(
    cronExpr,
    () => {
      console.log(
        `[auto-punchout] trigger @ ${new Date().toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
          hour12: true,
        })} IST`
      );
      runAutoPunchOut();
    },
    {
      scheduled: true,
      timezone: "Asia/Kolkata", // ✅ IST timezone
    }
  );
}

module.exports = { scheduleAutoPunchOut, runAutoPunchOut };
