import { Outlet, Link, useNavigate } from 'react-router-dom';
import { clearAuth, getUser } from '../lib/auth';

export default function AdminLayout() {
  const nav = useNavigate();
  const u = getUser();
  return (
    <div className="min-h-screen bg-white">
      <header className="flex items-center justify-between px-6 h-14 bg-blue-600 text-white">
        <div className="font-bold">HRMS Admin</div>
        <div className="flex items-center gap-4">
          <span className="text-sm">{u?.name}</span>
          <button onClick={() => { clearAuth(); nav('/login'); }} className="text-sm underline">Logout</button>
        </div>
      </header>
      <nav className="px-6 py-3 bg-blue-50 border-b">
        <Link className="mr-4" to="/admin">Dashboard</Link>
      </nav>
      <main className="p-6">
        <Outlet />
      </main>
    </div>
  );
}
