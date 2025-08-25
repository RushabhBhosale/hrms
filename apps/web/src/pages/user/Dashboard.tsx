import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import RoleGuard from '../../components/RoleGuard';

interface Attendance {
  firstPunchIn?: string;
  lastPunchOut?: string;
  lastPunchIn?: string;
  workedMs?: number;
}

function format(ms: number) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600)
    .toString()
    .padStart(2, '0');
  const m = Math.floor((total % 3600) / 60)
    .toString()
    .padStart(2, '0');
  const s = Math.floor(total % 60)
    .toString()
    .padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export default function UserDash() {
  const [attendance, setAttendance] = useState<Attendance | null>(null);
  const [elapsed, setElapsed] = useState(0);

  async function load() {
    const res = await api.get('/attendance/today');
    setAttendance(res.data.attendance);
  }

  async function punch(action: 'in' | 'out') {
    await api.post('/attendance/punch', { action });
    load();
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (attendance?.lastPunchIn) {
      const start = new Date(attendance.lastPunchIn).getTime();
      const base = attendance.workedMs || 0;
      const interval = setInterval(() => {
        setElapsed(base + (Date.now() - start));
      }, 1000);
      return () => clearInterval(interval);
    } else if (attendance?.workedMs) {
      setElapsed(attendance.workedMs);
    } else {
      setElapsed(0);
    }
  }, [attendance]);

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold">User Area</h2>
      <div className="p-4 border rounded space-y-2">
        <div>Time worked today: {format(elapsed)}</div>
        {!attendance?.lastPunchIn ? (
          <button
            className="px-4 py-1 bg-green-500 text-white"
            onClick={() => punch('in')}
          >
            Punch In
          </button>
        ) : (
          <button
            className="px-4 py-1 bg-red-500 text-white"
            onClick={() => punch('out')}
          >
            Punch Out
          </button>
        )}
      </div>
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
        <div className="p-4 border rounded">General</div>
        <RoleGuard sub={["hr"]}>
          <div className="p-4 border rounded">HR Panel</div>
        </RoleGuard>
        <RoleGuard sub={["manager"]}>
          <div className="p-4 border rounded">Manager Panel</div>
        </RoleGuard>
      </div>
    </div>
  );
}
