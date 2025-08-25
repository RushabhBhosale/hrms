import { useEffect, useState, FormEvent } from 'react';
import { api } from '../../lib/api';

interface CompanyUser {
  id: string;
  name: string;
  email: string;
  subRoles: string[];
}

export default function AdminDash() {
  const [users, setUsers] = useState<CompanyUser[]>([]);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'hr' });

  async function load() {
    try {
      const res = await api.get('/companies/users');
      setUsers(res.data.users);
    } catch (e) {
      console.error(e);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await api.post('/companies/users', form);
      setForm({ name: '', email: '', password: '', role: 'hr' });
      load();
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold">Admin Dashboard</h2>
        <div className="text-sm">Company settings, departments, roles</div>
      </div>

      <form onSubmit={submit} className="space-y-2 max-w-md">
        <input
          className="w-full border p-1"
          placeholder="Name"
          value={form.name}
          onChange={e => setForm({ ...form, name: e.target.value })}
        />
        <input
          className="w-full border p-1"
          placeholder="Email"
          type="email"
          value={form.email}
          onChange={e => setForm({ ...form, email: e.target.value })}
        />
        <input
          className="w-full border p-1"
          placeholder="Password"
          type="password"
          value={form.password}
          onChange={e => setForm({ ...form, password: e.target.value })}
        />
        <select
          className="w-full border p-1"
          value={form.role}
          onChange={e => setForm({ ...form, role: e.target.value })}
        >
          <option value="hr">HR</option>
          <option value="manager">Manager</option>
          <option value="developer">Developer</option>
        </select>
        <button className="px-4 py-1 bg-blue-500 text-white" type="submit">
          Add User
        </button>
      </form>

      <div>
        <h3 className="font-semibold mb-2">Company Users</h3>
        <table className="w-full text-sm border">
          <thead>
            <tr className="border-b">
              <th className="p-1 text-left">Name</th>
              <th className="p-1 text-left">Email</th>
              <th className="p-1 text-left">Role</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} className="border-b">
                <td className="p-1">{u.name}</td>
                <td className="p-1">{u.email}</td>
                <td className="p-1">{u.subRoles[0]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

