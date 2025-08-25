import { Outlet, Link, useNavigate } from 'react-router-dom';
import { clearAuth, getUser } from '../lib/auth';

export default function UserLayout() {
  const nav = useNavigate();
  const u = getUser();
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between px-6 h-14 bg-slate-900 text-white">
        <div className="font-bold">HRMS</div>
        <div className="flex items-center gap-3">
          <div className="text-xs">{u?.subRoles.join(', ')}</div>
          <button onClick={() => { clearAuth(); nav('/login'); }} className="text-sm underline">Logout</button>
        </div>
      </header>
      <nav className="px-6 py-3 bg-slate-100 border-b">
        <Link className="mr-4" to="/app">Dashboard</Link>
      </nav>
      <main className="p-6">
        <Outlet />
      </main>
    </div>
  );
}
