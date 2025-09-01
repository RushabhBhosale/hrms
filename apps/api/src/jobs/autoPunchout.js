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

    // 🔹 Find all today's records with an open punch-in
    const records = await Attendance.find({
      date: todayStart,
      lastPunchIn: { $exists: true },
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
      if (!(now > lastIn)) continue;

      const addMs = now.getTime() - lastIn.getTime();
      rec.workedMs = (rec.workedMs || 0) + addMs;
      rec.lastPunchOut = now;
      rec.lastPunchIn = undefined;
      rec.autoPunchOut = true;
      await rec.save();
      closed++;

      console.log(
        `[auto-punchout] closed employee=${
          rec.employee
        } date=${todayStart.toISOString()} +${Math.round(addMs / 60000)}m`
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

  setTimeout(() => {
    runAutoPunchOut();
  }, 10_000);
}

module.exports = { scheduleAutoPunchOut, runAutoPunchOut };
