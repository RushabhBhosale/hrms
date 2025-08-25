import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

export default function AdminDash() {
  const [stats, setStats] = useState({ users: 0, present: 0 });

  useEffect(() => {
    async function load() {
      try {
        const users = await api.get('/companies/users');
        const att = await api.get('/attendance/company/today');
        setStats({
          users: users.data.users.length,
          present: att.data.attendance.length
        });
      } catch (err) {
        console.error(err);
      }
    }
    load();
  }, []);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">Admin Dashboard</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="p-4 bg-blue-100 rounded">Total Users: {stats.users}</div>
        <div className="p-4 bg-green-100 rounded">Today's Attendance: {stats.present}</div>
      </div>
    </div>
  );
}
