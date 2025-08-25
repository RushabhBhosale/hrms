import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

interface Record {
  date: string;
  firstPunchIn?: string;
  lastPunchOut?: string;
}

export default function AttendanceRecords() {
  const [records, setRecords] = useState<Record[]>([]);

  useEffect(() => {
    api
      .get('/attendance/history')
      .then(res => setRecords(res.data.attendance))
      .catch(err => console.error(err));
  }, []);

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold">Attendance Records</h2>
      <table className="w-full text-sm border">
        <thead>
          <tr className="border-b">
            <th className="p-1 text-left">Date</th>
            <th className="p-1 text-left">First In</th>
            <th className="p-1 text-left">Last Out</th>
          </tr>
        </thead>
        <tbody>
          {records.map(r => (
            <tr key={r.date} className="border-b">
              <td className="p-1">{new Date(r.date).toLocaleDateString()}</td>
              <td className="p-1">
                {r.firstPunchIn ? new Date(r.firstPunchIn).toLocaleTimeString() : '-'}
              </td>
              <td className="p-1">
                {r.lastPunchOut ? new Date(r.lastPunchOut).toLocaleTimeString() : '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
