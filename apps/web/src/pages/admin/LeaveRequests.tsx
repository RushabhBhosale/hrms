import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

interface Leave {
  _id: string;
  employee: { _id: string; name: string };
  startDate: string;
  endDate: string;
  reason?: string;
  status: string;
  adminMessage?: string;
}

export default function LeaveRequests() {
  const [leaves, setLeaves] = useState<Leave[]>([]);

  function load() {
    api
      .get('/leaves/company')
      .then(res => setLeaves(res.data.leaves))
      .catch(err => console.error(err));
  }

  useEffect(() => {
    load();
  }, []);

  async function decide(id: string, action: 'approve' | 'reject') {
    const message = prompt('Message');
    try {
      await api.post(`/leaves/${id}/${action}`, { message });
      load();
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold">Leave Requests</h2>
      <table className="w-full text-sm border">
        <thead>
          <tr className="border-b">
            <th className="p-1 text-left">Employee</th>
            <th className="p-1 text-left">Start</th>
            <th className="p-1 text-left">End</th>
            <th className="p-1 text-left">Status</th>
            <th className="p-1 text-left">Actions</th>
          </tr>
        </thead>
        <tbody>
          {leaves.map(l => (
            <tr key={l._id} className="border-b">
              <td className="p-1">{l.employee.name}</td>
              <td className="p-1">{new Date(l.startDate).toLocaleDateString()}</td>
              <td className="p-1">{new Date(l.endDate).toLocaleDateString()}</td>
              <td className="p-1">{l.status}</td>
              <td className="p-1 space-x-2">
                {l.status === 'PENDING' && (
                  <>
                    <button
                      className="px-2 py-0.5 bg-green-500 text-white"
                      onClick={() => decide(l._id, 'approve')}
                    >
                      Approve
                    </button>
                    <button
                      className="px-2 py-0.5 bg-red-500 text-white"
                      onClick={() => decide(l._id, 'reject')}
                    >
                      Reject
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
