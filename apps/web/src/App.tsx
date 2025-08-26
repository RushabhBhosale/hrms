import { Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Protected from './components/Protected';
import RoleGuard from './components/RoleGuard';
import SuperAdminLayout from './layouts/SuperAdminLayout';
import AdminLayout from './layouts/AdminLayout';
import EmployeeLayout from './layouts/EmployeeLayout';
import SADash from './pages/superadmin/Dashboard';
import CompanyList from './pages/superadmin/CompanyList';
import AddCompany from './pages/superadmin/AddCompany';

import AdminDash from './pages/admin/Dashboard';
import AddEmployee from './pages/admin/AddEmployee';
import EmployeeList from './pages/admin/EmployeeList';
import LeaveRequests from './pages/admin/LeaveRequests';
import LeaveSettings from './pages/admin/LeaveSettings';

import EmployeeDash from './pages/employee/Dashboard';
import AttendanceRecords from './pages/employee/AttendanceRecords';
import LeaveRequest from './pages/employee/LeaveRequest';
import Documents from './pages/employee/Documents';
import LeaveApprovals from './pages/employee/LeaveApprovals';
import EmployeeDetails from './pages/admin/EmployeeDetails';

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
        <Route path="employees/add" element={<AddEmployee />} />
        <Route path="employees" element={<EmployeeList />} />
        <Route path="employees/:id" element={<EmployeeDetails />} />
        <Route path="attendances" element={<AttendanceRecords />} />
        <Route path="leave-settings" element={<LeaveSettings />} />
        <Route path="leaves" element={<LeaveRequests />} />
      </Route>

      <Route
        path="/app/*"
        element={
          <Protected>
            <RoleGuard primary={["EMPLOYEE", "ADMIN", "SUPERADMIN"]}>
              <EmployeeLayout />
            </RoleGuard>
          </Protected>
        }
      >
        <Route index element={<EmployeeDash />} />
        <Route path="attendance" element={<AttendanceRecords />} />
        <Route
          path="attendances"
          element={
          <RoleGuard sub={["hr", "manager"]}>
              <AttendanceRecords />
            </RoleGuard>
          }
        />
        <Route path="leave" element={<LeaveRequest />} />
        <Route path="approvals" element={<LeaveApprovals />} />
        <Route path="documents" element={<Documents />} />
      </Route>

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
