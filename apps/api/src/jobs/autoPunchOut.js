const Attendance = require("../models/Attendance");

function parseAutoTime() {
  // Format: HH:mm (24h). Defaults to 08:30
  const raw = process.env.AUTO_PUNCH_OUT_TIME || "08:30";
  const m = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return { hour: 8, minute: 30 };
  const hour = Math.max(0, Math.min(23, parseInt(m[1], 10)));
  const minute = Math.max(0, Math.min(59, parseInt(m[2], 10)));
  return { hour, minute };
}

function scheduleAutoPunchOut() {
  // Check every minute for the configured auto punch-out time
  setInterval(async () => {
    try {
      const now = new Date();
      const { hour, minute } = parseAutoTime();
      if (now.getHours() !== hour || now.getMinutes() !== minute) return;

      // The punch-out timestamp is today's date at configured time
      const punchOutTime = new Date(now);
      punchOutTime.setSeconds(0, 0);

      // Target records are for "yesterday" (start of day) with open punches
      const y = new Date(punchOutTime);
      y.setDate(y.getDate() - 1);
      y.setHours(0, 0, 0, 0);
      const records = await Attendance.find({
        date: y,
        firstPunchIn: { $ne: null },
        lastPunchOut: { $exists: false },
      });
      for (const r of records) {
        r.workedMs += punchOutTime.getTime() - r.firstPunchIn.getTime();
        r.lastPunchOut = punchOutTime;
        r.firstPunchIn = undefined;
        r.autoPunchOut = true;
        await r.save();
      }
    } catch (err) {
      console.error("autoPunchOut job error", err);
    }
  }, 60 * 1000);
}

module.exports = { scheduleAutoPunchOut };
