import { useEffect, useState, FormEvent } from 'react';
import { api } from '../../lib/api';

type Company = {
  _id: string;
  name: string;
  admin?: { name: string; email: string };
};

export default function SADash() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyName, setCompanyName] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [existingCompany, setExistingCompany] = useState('');
  const [newAdminName, setNewAdminName] = useState('');
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [newAdminPassword, setNewAdminPassword] = useState('');

  async function load() {
    try {
      const res = await api.get('/companies');
      setCompanies(res.data.companies);
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
      await api.post('/companies', { companyName, adminName, adminEmail, adminPassword });
      setCompanyName('');
      setAdminName('');
      setAdminEmail('');
      setAdminPassword('');
      load();
    } catch (err) {
      console.error(err);
    }
  }

  async function submitExisting(e: FormEvent) {
    e.preventDefault();
    try {
      await api.post(`/companies/${existingCompany}/admin`, {
        adminName: newAdminName,
        adminEmail: newAdminEmail,
        adminPassword: newAdminPassword
      });
      setExistingCompany('');
      setNewAdminName('');
      setNewAdminEmail('');
      setNewAdminPassword('');
      load();
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold">Superadmin Dashboard</h2>
        <div className="text-sm">Manage tenants, admins, and global settings</div>
      </div>

      <form onSubmit={submit} className="space-y-2 max-w-md">
        <input
          className="w-full border p-1"
          placeholder="Company Name"
          value={companyName}
          onChange={e => setCompanyName(e.target.value)}
        />
        <input
          className="w-full border p-1"
          placeholder="Admin Name"
          value={adminName}
          onChange={e => setAdminName(e.target.value)}
        />
        <input
          className="w-full border p-1"
          placeholder="Admin Email"
          type="email"
          value={adminEmail}
          onChange={e => setAdminEmail(e.target.value)}
        />
        <input
          className="w-full border p-1"
          placeholder="Admin Password"
          type="password"
          value={adminPassword}
          onChange={e => setAdminPassword(e.target.value)}
        />
        <button className="px-4 py-1 bg-blue-500 text-white" type="submit">
          Add Company
        </button>
      </form>

      <form onSubmit={submitExisting} className="space-y-2 max-w-md">
        <h3 className="font-semibold">Add Admin to Company</h3>
        <select
          className="w-full border p-1"
          value={existingCompany}
          onChange={e => setExistingCompany(e.target.value)}
        >
          <option value="">Select Company</option>
          {companies.filter(c => !c.admin).map(c => (
            <option key={c._id} value={c._id}>
              {c.name}
            </option>
          ))}
        </select>
        <input
          className="w-full border p-1"
          placeholder="Admin Name"
          value={newAdminName}
          onChange={e => setNewAdminName(e.target.value)}
        />
        <input
          className="w-full border p-1"
          placeholder="Admin Email"
          type="email"
          value={newAdminEmail}
          onChange={e => setNewAdminEmail(e.target.value)}
        />
        <input
          className="w-full border p-1"
          placeholder="Admin Password"
          type="password"
          value={newAdminPassword}
          onChange={e => setNewAdminPassword(e.target.value)}
        />
        <button className="px-4 py-1 bg-blue-500 text-white" type="submit" disabled={!existingCompany}>
          Add Admin
        </button>
      </form>

      <div>
        <h3 className="font-semibold mb-2">Companies</h3>
        <ul className="space-y-1">
          {companies.map(c => (
            <li key={c._id} className="text-sm">
              {c.name} – {c.admin ? `${c.admin.name} (${c.admin.email})` : 'No admin'}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
