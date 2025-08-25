import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

interface AttendanceRecord {
  user: { id: string; name: string };
  firstPunchIn?: string;
  lastPunchOut?: string;
}

export default function AttendanceList() {
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);

  useEffect(() => {
    api
      .get('/attendance/company/today')
      .then(res => setAttendance(res.data.attendance))
      .catch(err => console.error(err));
  }, []);

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold">Attendance</h2>
      <table className="w-full text-sm border">
        <thead>
          <tr className="border-b">
            <th className="p-1 text-left">Name</th>
            <th className="p-1 text-left">First In</th>
            <th className="p-1 text-left">Last Out</th>
          </tr>
        </thead>
        <tbody>
          {attendance.map(a => (
            <tr key={a.user.id} className="border-b">
              <td className="p-1">{a.user.name}</td>
              <td className="p-1">
                {a.firstPunchIn ? new Date(a.firstPunchIn).toLocaleTimeString() : '-'}
              </td>
              <td className="p-1">
                {a.lastPunchOut ? new Date(a.lastPunchOut).toLocaleTimeString() : '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
