import { Outlet, Link, useNavigate } from 'react-router-dom';
import { clearAuth, getUser } from '../lib/auth';

export default function UserLayout() {
  const nav = useNavigate();
  const u = getUser();

  const links = [
    { to: '/app', label: 'Dashboard' },
    { to: '/app/attendance', label: 'Attendance' }
  ];

  return (
    <div className="min-h-screen flex bg-slate-50">
      <aside className="w-56 bg-slate-900 text-white flex flex-col p-4">
        <div className="font-bold mb-6">HRMS</div>
        <nav className="flex-1 space-y-2">
          {links.map(l => (
            <Link key={l.to} to={l.to} className="block hover:underline">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="pt-4 border-t border-slate-700 text-sm">
          <div className="mb-2">{u?.subRoles.join(', ')}</div>
          <button
            onClick={() => {
              clearAuth();
              nav('/login');
            }}
            className="underline"
          >
            Logout
          </button>
        </div>
      </aside>
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}
