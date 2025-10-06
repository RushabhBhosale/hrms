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
import ManualAttendanceRequests from "./pages/admin/ManualAttendanceRequests";
import MyProjects from "./pages/projects/MyProjects";
import ProjectDetails from "./pages/projects/ProjectDetails";
import ProjectTasks from "./pages/projects/ProjectTasks";
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
import AttendanceReportPage from "./pages/admin/reports/AttendanceReport";
import ProjectReportPage from "./pages/admin/reports/ProjectReport";
import LeaveReportsPage from "./pages/admin/reports/LeaveReports";
import SalarySlipsReportPage from "./pages/admin/reports/SalarySlipsReport";
import LandingPage from "./pages/LandingPage";
import Announcements from "./pages/employee/Announcements";
import Invoices from "./pages/admin/Invoices";
import InvoiceCreate from "./pages/admin/InvoiceCreate";
import InvoiceDetails from "./pages/admin/InvoiceDetails";
import Expenses from "./pages/admin/Expenses";

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
        <Route path="projects/:id/tasks" element={<ProjectTasks />} />
        <Route path="attendances" element={<AttendanceRecords />} />
        <Route
          path="attendance/manual-requests"
          element={<ManualAttendanceRequests />}
        />
        <Route path="reports" element={<Navigate to="reports/attendance" replace />} />
        <Route
          path="reports/attendance"
          element={<AttendanceReportPage />}
        />
        <Route path="reports/projects" element={<ProjectReportPage />} />
        <Route path="reports/leaves" element={<LeaveReportsPage />} />
        <Route
          path="reports/salary-slips"
          element={<SalarySlipsReportPage />}
        />
        <Route path="report" element={<Navigate to="reports/attendance" replace />} />
        <Route path="leave-settings" element={<LeaveSettings />} />
        <Route path="company" element={<CompanyProfile />} />
        <Route path="company-timing" element={<CompanyTiming />} />
        <Route path="roles" element={<RoleSettings />} />
        <Route path="leaves" element={<LeaveRequests />} />
        <Route path="salary/template" element={<SalaryTemplate />} />
        <Route path="salary/slips" element={<SalarySlipsAdmin />} />
        <Route path="announcements" element={<AnnouncementsAdmin />} />
        <Route path="invoices" element={<Invoices />} />
        <Route path="invoices/new" element={<InvoiceCreate />} />
        <Route path="invoices/:id" element={<InvoiceDetails />} />
        <Route path="expenses" element={<Expenses />} />
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
            <RoleGuard permission={{ module: "attendance", action: "read" }}>
              <AttendanceRecords />
            </RoleGuard>
          }
        />
        <Route
          path="attendance/manual-requests"
          element={
            <RoleGuard permission={{ module: "attendance", action: "write" }}>
              <ManualAttendanceRequests />
            </RoleGuard>
          }
        />
        <Route
          path="report"
          element={
            <RoleGuard permission={{ module: "reports", action: "read" }}>
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
            <RoleGuard permission={{ module: "salary", action: "write" }}>
              <SalariesManage />
            </RoleGuard>
          }
        />
        <Route path="documents" element={<Documents />} />
        <Route path="tasks" element={<MyTasks />} />
        <Route path="projects" element={<MyProjects />} />
        <Route path="projects/:id" element={<ProjectDetails />} />
        <Route path="projects/:id/tasks" element={<ProjectTasks />} />
        <Route path="announcements" element={<Announcements />} />
        <Route
          path="expenses"
          element={
            <RoleGuard permission={{ module: "finance", action: "write" }}>
              <Expenses />
            </RoleGuard>
          }
        />
        <Route
          path="invoices"
          element={
            <RoleGuard permission={{ module: "finance", action: "read" }}>
              <Invoices />
            </RoleGuard>
          }
        />
        <Route
          path="invoices/:id"
          element={
            <RoleGuard permission={{ module: "finance", action: "read" }}>
              <InvoiceDetails />
            </RoleGuard>
          }
        />
        <Route path="profile" element={<Profile />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
