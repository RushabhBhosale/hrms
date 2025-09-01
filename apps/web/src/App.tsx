import { Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import RegisterCompany from "./pages/RegisterCompany";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Profile from "./pages/Profile";
import Protected from "./components/Protected";
import RoleGuard from "./components/RoleGuard";
import SuperAdminLayout from "./layouts/SuperAdminLayout";
import AdminLayout from "./layouts/AdminLayout";
import EmployeeLayout from "./layouts/EmployeeLayout";
import SADash from "./pages/superadmin/Dashboard";
import CompanyList from "./pages/superadmin/CompanyList";
import AddCompany from "./pages/superadmin/AddCompany";

import AdminDash from "./pages/admin/Dashboard";
import AddEmployee from "./pages/admin/AddEmployee";
import EmployeeList from "./pages/admin/EmployeeList";
import LeaveRequests from "./pages/admin/LeaveRequests";
import LeaveSettings from "./pages/admin/LeaveSettings";
import RoleSettings from "./pages/admin/RoleSettings";
import ProjectsAdmin from "./pages/admin/Projects";
import SalaryTemplate from "./pages/admin/SalaryTemplate";
import SalarySlipsAdmin from "./pages/admin/SalarySlips";
import CompanyTiming from "./pages/admin/CompanyTiming";
import AnnouncementsAdmin from "./pages/admin/Announcements";
import CompanyProfile from "./pages/admin/CompanyProfile";
import MyProjects from "./pages/projects/MyProjects";
import ProjectDetails from "./pages/projects/ProjectDetails";
import MyTasks from "./pages/tasks/MyTasks";

import EmployeeDash from "./pages/employee/Dashboard";
import AttendanceRecords from "./pages/employee/AttendanceRecords";
import LeaveRequest from "./pages/employee/LeaveRequest";
import Documents from "./pages/employee/Documents";
import LeaveApprovals from "./pages/employee/LeaveApprovals";
import MySalarySlip from "./pages/employee/SalarySlip";
import SalariesManage from "./pages/employee/SalariesManage";
import EmployeeDetails from "./pages/admin/EmployeeDetails";
import MonthlyReport from "./pages/report/MonthlyReport";
import LandingPage from "./pages/LandingPage";
import Announcements from "./pages/employee/Announcements";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/register-company" element={<RegisterCompany />} />
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

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
        <Route path="profile" element={<Profile />} />
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
        <Route path="projects" element={<ProjectsAdmin />} />
        <Route path="projects/:id" element={<ProjectDetails />} />
        <Route path="attendances" element={<AttendanceRecords />} />
        <Route path="report" element={<MonthlyReport />} />
        <Route path="leave-settings" element={<LeaveSettings />} />
        <Route path="company" element={<CompanyProfile />} />
        <Route path="company-timing" element={<CompanyTiming />} />
        <Route path="roles" element={<RoleSettings />} />
        <Route path="leaves" element={<LeaveRequests />} />
        <Route path="salary/template" element={<SalaryTemplate />} />
        <Route path="salary/slips" element={<SalarySlipsAdmin />} />
        <Route path="announcements" element={<AnnouncementsAdmin />} />
        <Route path="profile" element={<Profile />} />
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
        <Route
          path="report"
          element={
            <RoleGuard sub={["hr", "manager"]}>
              <MonthlyReport />
            </RoleGuard>
          }
        />
        <Route path="leave" element={<LeaveRequest />} />
        <Route path="approvals" element={<LeaveApprovals />} />
        <Route path="salary-slip" element={<MySalarySlip />} />
        <Route
          path="salaries"
          element={
            <RoleGuard sub={["hr"]}>
              <SalariesManage />
            </RoleGuard>
          }
        />
        <Route path="documents" element={<Documents />} />
        <Route path="tasks" element={<MyTasks />} />
        <Route path="projects" element={<MyProjects />} />
        <Route path="projects/:id" element={<ProjectDetails />} />
        <Route path="announcements" element={<Announcements />} />
        <Route path="profile" element={<Profile />} />
      </Route>

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
