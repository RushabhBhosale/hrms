import { Outlet, Link, useNavigate } from 'react-router-dom';
import { clearAuth, getUser } from '../lib/auth';

export default function SuperAdminLayout() {
  const nav = useNavigate();
  const u = getUser();

  const links = [
    { to: '/superadmin', label: 'Dashboard' },
    { to: '/superadmin/companies', label: 'Companies' },
    { to: '/superadmin/companies/add', label: 'Add Company' }
  ];

  return (
    <div className="min-h-screen flex bg-gray-50">
      <aside className="w-56 bg-black text-white flex flex-col p-4">
        <div className="font-bold mb-6">HRMS Superadmin</div>
        <nav className="flex-1 space-y-2">
          {links.map(l => (
            <Link key={l.to} to={l.to} className="block hover:underline">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="pt-4 border-t border-gray-700 text-sm">
          <div className="mb-2">{u?.name}</div>
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
