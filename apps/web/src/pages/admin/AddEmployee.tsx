import { useState, FormEvent, ChangeEvent } from 'react';
import { api } from '../../lib/api';

export default function AddEmployee() {
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'hr',
    address: '',
    phone: ''
  });
  const [docs, setDocs] = useState<FileList | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      if (docs) Array.from(docs).forEach(f => fd.append('documents', f));
      await api.post('/companies/employees', fd, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setForm({ name: '', email: '', password: '', role: 'hr', address: '', phone: '' });
      setDocs(null);
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold">Add Employee</h2>
      <form onSubmit={submit} className="space-y-2 max-w-md" encType="multipart/form-data">
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
        <input
          className="w-full border p-1"
          placeholder="Address"
          value={form.address}
          onChange={e => setForm({ ...form, address: e.target.value })}
        />
        <input
          className="w-full border p-1"
          placeholder="Phone"
          value={form.phone}
          onChange={e => setForm({ ...form, phone: e.target.value })}
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
        <input
          className="w-full border p-1"
          type="file"
          multiple
          onChange={(e: ChangeEvent<HTMLInputElement>) => setDocs(e.target.files)}
        />
        <button className="px-4 py-1 bg-blue-500 text-white" type="submit">
          Add Employee
        </button>
      </form>
    </div>
  );
}
