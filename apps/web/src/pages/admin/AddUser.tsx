import { useState, FormEvent } from 'react';
import { api } from '../../lib/api';

export default function AddUser() {
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'hr'
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await api.post('/companies/users', form);
      setForm({ name: '', email: '', password: '', role: 'hr' });
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold">Add User</h2>
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
    </div>
  );
}
