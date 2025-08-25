import { Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Protected from './components/Protected';
import RoleGuard from './components/RoleGuard';
import SuperAdminLayout from './layouts/SuperAdminLayout';
import AdminLayout from './layouts/AdminLayout';
import UserLayout from './layouts/UserLayout';
import SADash from './pages/superadmin/Dashboard';
import AdminDash from './pages/admin/Dashboard';
import UserDash from './pages/user/Dashboard';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route
        path="/superadmin/*"
        element={
          <Protected>
            <RoleGuard primary={["SUPERADMIN"]}>
              <SuperAdminLayout />
            </RoleGuard>
          </Protected>
        }
      >
        <Route index element={<SADash />} />
      </Route>

      <Route
        path="/admin/*"
        element={
          <Protected>
            <RoleGuard primary={["ADMIN", "SUPERADMIN"]}>
              <AdminLayout />
            </RoleGuard>
          </Protected>
        }
      >
        <Route index element={<AdminDash />} />
      </Route>

      <Route
        path="/app/*"
        element={
          <Protected>
            <RoleGuard primary={["USER", "ADMIN", "SUPERADMIN"]}>
              <UserLayout />
            </RoleGuard>
          </Protected>
        }
      >
        <Route index element={<UserDash />} />
      </Route>

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
