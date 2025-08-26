const Attendance = require('../models/Attendance');

function scheduleAutoPunchOut() {
  // check every minute for midnight and auto punch out any pending records
  setInterval(async () => {
    try {
      const now = new Date();
      if (now.getMinutes() !== 0 || now.getHours() !== 0) return;
      const midnight = new Date(now);
      midnight.setSeconds(0, 0);
      // get yesterday's date
      const y = new Date(midnight);
      y.setDate(y.getDate() - 1);
      y.setHours(0, 0, 0, 0);
      const records = await Attendance.find({
        date: y,
        lastPunchIn: { $ne: null },
        lastPunchOut: { $exists: false }
      });
      for (const r of records) {
        r.workedMs += midnight.getTime() - r.lastPunchIn.getTime();
        r.lastPunchOut = midnight;
        r.lastPunchIn = undefined;
        r.autoPunchOut = true;
        await r.save();
      }
    } catch (err) {
      console.error('autoPunchOut job error', err);
    }
  }, 60 * 1000);
}

module.exports = { scheduleAutoPunchOut };
