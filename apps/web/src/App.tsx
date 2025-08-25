import { Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Protected from './components/Protected';
import RoleGuard from './components/RoleGuard';
import SuperAdminLayout from './layouts/SuperAdminLayout';
import AdminLayout from './layouts/AdminLayout';
import UserLayout from './layouts/UserLayout';
import SADash from './pages/superadmin/Dashboard';
import CompanyList from './pages/superadmin/CompanyList';
import AddCompany from './pages/superadmin/AddCompany';

import AdminDash from './pages/admin/Dashboard';
import AddUser from './pages/admin/AddUser';
import UserList from './pages/admin/UserList';
import AttendanceList from './pages/admin/AttendanceList';

import UserDash from './pages/user/Dashboard';
import AttendanceRecords from './pages/user/AttendanceRecords';

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
        <Route path="companies" element={<CompanyList />} />
        <Route path="companies/add" element={<AddCompany />} />
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
        <Route path="users/add" element={<AddUser />} />
        <Route path="users" element={<UserList />} />
        <Route path="attendances" element={<AttendanceList />} />
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
        <Route path="attendance" element={<AttendanceRecords />} />
      </Route>

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
