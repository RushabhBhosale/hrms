import { useEffect, useState, FormEvent } from 'react';
import { api } from '../../lib/api';

interface Leave {
  _id: string;
  startDate: string;
  endDate: string;
  reason?: string;
  status: string;
  adminMessage?: string;
}

export default function LeaveRequest() {
  const [form, setForm] = useState({ startDate: '', endDate: '', reason: '' });
  const [leaves, setLeaves] = useState<Leave[]>([]);

  function load() {
    api
      .get('/leaves')
      .then(res => setLeaves(res.data.leaves))
      .catch(err => console.error(err));
  }

  useEffect(() => {
    load();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await api.post('/leaves', form);
      setForm({ startDate: '', endDate: '', reason: '' });
      load();
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">Request Leave</h2>
      <form onSubmit={submit} className="space-y-2 max-w-md">
        <input
          type="date"
          className="w-full border p-1"
          value={form.startDate}
          onChange={e => setForm({ ...form, startDate: e.target.value })}
        />
        <input
          type="date"
          className="w-full border p-1"
          value={form.endDate}
          onChange={e => setForm({ ...form, endDate: e.target.value })}
        />
        <textarea
          className="w-full border p-1"
          placeholder="Reason"
          value={form.reason}
          onChange={e => setForm({ ...form, reason: e.target.value })}
        />
        <button type="submit" className="px-4 py-1 bg-blue-500 text-white">
          Submit
        </button>
      </form>

      <table className="w-full text-sm border">
        <thead>
          <tr className="border-b">
            <th className="p-1 text-left">Start</th>
            <th className="p-1 text-left">End</th>
            <th className="p-1 text-left">Status</th>
            <th className="p-1 text-left">Message</th>
          </tr>
        </thead>
        <tbody>
          {leaves.map(l => (
            <tr key={l._id} className="border-b">
              <td className="p-1">{new Date(l.startDate).toLocaleDateString()}</td>
              <td className="p-1">{new Date(l.endDate).toLocaleDateString()}</td>
              <td className="p-1">{l.status}</td>
              <td className="p-1">{l.adminMessage || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
