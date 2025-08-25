import { FormEvent, useState } from 'react';
import { api } from '../lib/api';
import { setAuth } from '../lib/auth';
import { useNavigate } from 'react-router-dom';

export default function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState('superadmin@hrms.dev');
  const [password, setPassword] = useState('password');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr('');
    try {
      const res = await api.post('/auth/login', { email, password });
      setAuth(res.data.token, res.data.employee);
      const role = res.data.employee.primaryRole;
      if (role === 'SUPERADMIN') nav('/superadmin');
      else if (role === 'ADMIN') nav('/admin');
      else nav('/app');
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-gray-50">
      <form onSubmit={onSubmit} className="bg-white p-6 rounded-lg shadow w-full max-w-sm space-y-4">
        <h1 className="text-xl font-semibold">Sign in</h1>
        {err && <div className="text-red-600 text-sm">{err}</div>}
        <div className="space-y-1">
          <label className="text-sm">Email</label>
          <input value={email} onChange={e=>setEmail(e.target.value)} className="w-full border rounded px-3 h-10" type="email" />
        </div>
        <div className="space-y-1">
          <label className="text-sm">Password</label>
          <input value={password} onChange={e=>setPassword(e.target.value)} className="w-full border rounded px-3 h-10" type="password" />
        </div>
        <button disabled={loading} className="w-full h-10 rounded bg-black text-white">{loading ? '...' : 'Login'}</button>
      </form>
    </div>
  );
}
