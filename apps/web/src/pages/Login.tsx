import { FormEvent, useState } from 'react';
import { api } from '../lib/api';
import { setAuth } from '../lib/auth';
import { applyTheme } from '../lib/theme';
import { Link, useNavigate } from 'react-router-dom';

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
      try { const t = await api.get('/companies/theme'); if (t?.data?.theme) applyTheme(t.data.theme); } catch {}
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
    <div className="min-h-screen grid place-items-center bg-bg">
      <form onSubmit={onSubmit} className="bg-surface p-6 rounded-lg border border-border shadow w-full max-w-sm space-y-4">
        <h1 className="text-xl font-semibold">Sign in</h1>
        {err && <div className="text-error text-sm">{err}</div>}
        <div className="space-y-1">
          <label className="text-sm">Email</label>
          <input value={email} onChange={e=>setEmail(e.target.value)} className="w-full border border-border bg-bg rounded px-3 h-10 outline-none focus:ring-2 focus:ring-primary" type="email" />
        </div>
        <div className="space-y-1">
          <label className="text-sm">Password</label>
          <input value={password} onChange={e=>setPassword(e.target.value)} className="w-full border border-border bg-bg rounded px-3 h-10 outline-none focus:ring-2 focus:ring-primary" type="password" />
        </div>
        <button disabled={loading} className="w-full h-10 rounded bg-primary text-white">{loading ? '...' : 'Login'}</button>
        <div className="text-right text-sm">
          <Link className="text-primary hover:underline" to="/forgot-password">Forgot password?</Link>
        </div>
      </form>
    </div>
  );
}
