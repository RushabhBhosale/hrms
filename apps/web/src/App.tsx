import { Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import RegisterCompany from "./pages/RegisterCompany";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Profile from "./pages/Profile";
import Protected from "./components/Protected";
import RoleGuard from "./components/RoleGuard";
import NoAccess from "./components/NoAccess";
import SuperAdminLayout from "./layouts/SuperAdminLayout";
import AdminLayout from "./layouts/AdminLayout";
import EmployeeLayout from "./layouts/EmployeeLayout";
import SADash from "./pages/superadmin/Dashboard";
import CompanyList from "./pages/superadmin/CompanyList";
import AddCompany from "./pages/superadmin/AddCompany";

import AdminDash from "./pages/admin/Dashboard";
import AddEmployee from "./pages/admin/AddEmployee";
import EmployeeList from "./pages/admin/EmployeeList";
import EmployeeArchive from "./pages/admin/EmployeeArchive";
import LeaveRequests from "./pages/admin/LeaveRequests";
import LeaveSettings from "./pages/admin/LeaveSettings";
import RoleSettings from "./pages/admin/RoleSettings";
import ProjectsAdmin from "./pages/admin/Projects";
import SalaryTemplate from "./pages/admin/SalaryTemplate";
import SalarySlipsAdmin from "./pages/admin/SalarySlips";
import CompanyTiming from "./pages/admin/CompanyTiming";
import AnnouncementsAdmin from "./pages/admin/Announcements";
import CompanyProfile from "./pages/admin/CompanyProfile";
import AddRole from "./pages/admin/AddRole";
import MyProjects from "./pages/projects/MyProjects";
import ProjectDetails from "./pages/projects/ProjectDetails";
import ProjectTasks from "./pages/projects/ProjectTasks";
import CreateProject from "./pages/projects/CreateProject";
import CreateTask from "./pages/projects/CreateTask";
import MyTasks from "./pages/tasks/MyTasks";
import TaskDetails from "./pages/tasks/TaskDetails";

import EmployeeDash from "./pages/employee/Dashboard";
import EmployeeReimbursements from "./pages/employee/Reimbursements";
import ReimbursementRequest from "./pages/employee/ReimbursementRequest";
import AttendanceRecords from "./pages/employee/AttendanceRecords";
import LeaveRequest from "./pages/employee/LeaveRequest";
import Documents from "./pages/employee/Documents";
import LeaveApprovals from "./pages/employee/LeaveApprovals";
import MySalarySlip from "./pages/employee/SalarySlip";
import SalariesManage from "./pages/employee/SalariesManage";
import EmployeeKRAs from "./pages/employee/KRAs";
import TeamPresence from "./pages/employee/TeamPresence";
import KRATeam from "./pages/employee/KRATeam";
import EmployeeDetails from "./pages/admin/EmployeeDetails";
import MonthlyReport from "./pages/report/MonthlyReport";
import AttendanceReportPage from "./pages/admin/reports/AttendanceReport";
import ProjectReportPage from "./pages/admin/reports/ProjectReport";
import LeaveReportsPage from "./pages/admin/reports/LeaveReports";
import SalarySlipsReportPage from "./pages/admin/reports/SalarySlipsReport";
import LeaveRecordsPage from "./pages/admin/reports/LeaveRecords";
import TimeTrackingReport from "./pages/admin/reports/TimeTrackingReport";
import LandingPage from "./pages/LandingPage";
import Announcements from "./pages/employee/Announcements";
import AttendanceRequests from "./pages/admin/AttendanceRequests";
import Invoices from "./pages/admin/Invoices";
import InvoiceCreate from "./pages/admin/InvoiceCreate";
import InvoiceDetails from "./pages/admin/InvoiceDetails";
import Expenses from "./pages/admin/Expenses";
import ReimbursementsAdmin from "./pages/admin/Reimbursements";
import AddReimbursementType from "./pages/admin/AddReimbursementType";
import Clients from "./pages/admin/Clients";
import AddClient from "./pages/admin/AddClient";
import ClientDetails from "./pages/admin/ClientDetails";
import InventoryList from "./pages/admin/InventoryList";
import InventoryAdd from "./pages/admin/InventoryAdd";
import InventoryCategoriesList from "./pages/admin/InventoryCategoriesList";
import InventoryCategoryAdd from "./pages/admin/InventoryCategoryAdd";
import HolidaysPage from "./pages/Holidays";
import KRAs from "./pages/admin/KRAs";
import KRAAll from "./pages/admin/KRAAll";
import KRAQuestions from "./pages/admin/KRAQuestions";
import Appraisals from "./pages/admin/Appraisals";
import OnboardingAdd from "./pages/admin/OnboardingAdd";
import OnboardingPipeline from "./pages/admin/OnboardingPipeline";

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
            <RoleGuard primary={["SUPERADMIN"]} fallback={<NoAccess />}>
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
            <RoleGuard primary={["ADMIN", "SUPERADMIN"]} fallback={<NoAccess />}>
              <AdminLayout />
            </RoleGuard>
          </Protected>
        }
      >
        <Route index element={<AdminDash />} />
        <Route path="employees/add" element={<AddEmployee />} />
        <Route path="employees" element={<EmployeeList />} />
        <Route path="employees/archive" element={<EmployeeArchive />} />
        <Route path="employees/:id" element={<EmployeeDetails />} />
        <Route path="onboarding" element={<OnboardingPipeline />} />
        <Route path="onboarding/pipeline" element={<OnboardingPipeline />} />
        <Route path="onboarding/add" element={<OnboardingAdd />} />
        <Route path="projects" element={<ProjectsAdmin />} />
        <Route path="projects/new" element={<CreateProject />} />
        <Route path="projects/:id" element={<ProjectDetails />} />
        <Route path="projects/:id/tasks" element={<ProjectTasks />} />
        <Route path="tasks/:id" element={<TaskDetails />} />
        <Route
          path="projects/:id/tasks/new"
          element={
            <RoleGuard
              permission={{ module: "tasks", action: "write" }}
              fallback={<NoAccess />}
            >
              <CreateTask />
            </RoleGuard>
          }
        />
        <Route path="attendances" element={<AttendanceRecords />} />
        <Route
          path="attendance-requests"
          element={<AttendanceRequests />}
        />
        <Route path="reports" element={<Navigate to="reports/attendance" replace />} />
        <Route
          path="reports/attendance"
          element={<AttendanceReportPage />}
        />
        <Route path="reports/projects" element={<ProjectReportPage />} />
        <Route path="reports/leaves" element={<LeaveReportsPage />} />
        <Route path="reports/leave-records" element={<LeaveRecordsPage />} />
        <Route
          path="reports/salary-slips"
          element={<SalarySlipsReportPage />}
        />
        <Route
          path="reports/time-tracking"
          element={<TimeTrackingReport />}
        />
        <Route path="report" element={<Navigate to="reports/attendance" replace />} />
        <Route path="holidays" element={<HolidaysPage />} />
        <Route path="leave-settings" element={<LeaveSettings />} />
        <Route path="company" element={<CompanyProfile />} />
        <Route path="company-timing" element={<CompanyTiming />} />
        <Route path="roles" element={<RoleSettings />} />
        <Route path="roles/new" element={<AddRole />} />
        <Route path="leaves" element={<LeaveRequests />} />
        <Route path="salary/template" element={<SalaryTemplate />} />
        <Route path="salary/slips" element={<SalarySlipsAdmin />} />
        <Route path="announcements" element={<AnnouncementsAdmin />} />
        <Route path="invoices" element={<Invoices />} />
        <Route path="invoices/new" element={<InvoiceCreate />} />
        <Route path="invoices/:id" element={<InvoiceDetails />} />
        <Route path="expenses" element={<Expenses />} />
        <Route path="reimbursements" element={<ReimbursementsAdmin />} />
        <Route
          path="reimbursements/types/new"
          element={<AddReimbursementType />}
        />
        <Route path="kras" element={<KRAs />} />
        <Route path="kras/questions" element={<KRAQuestions />} />
        <Route path="kras/all" element={<KRAAll />} />
        <Route path="appraisals" element={<Appraisals />} />
        <Route path="clients" element={<Clients />} />
        <Route path="clients/new" element={<AddClient />} />
        <Route path="clients/:id" element={<ClientDetails />} />
        <Route path="inventory" element={<InventoryList />} />
        <Route path="inventory/add" element={<InventoryAdd />} />
        <Route path="inventory/categories" element={<InventoryCategoriesList />} />
        <Route path="inventory/categories/add" element={<InventoryCategoryAdd />} />
        <Route path="profile" element={<Profile />} />
      </Route>

      <Route
        path="/app/*"
        element={
          <Protected>
            <RoleGuard
              primary={["EMPLOYEE", "ADMIN", "SUPERADMIN"]}
              fallback={<NoAccess />}
            >
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
            <RoleGuard
              permission={{ module: "attendance", action: "read" }}
              fallback={<NoAccess />}
            >
              <AttendanceRecords />
            </RoleGuard>
          }
        />
        <Route
          path="presence"
          element={
            <RoleGuard
              permission={{ module: "presence", action: "read" }}
              fallback={<NoAccess />}
            >
              <TeamPresence />
            </RoleGuard>
          }
        />
        <Route
          path="report"
          element={
            <RoleGuard
              permission={{ module: "reports", action: "read" }}
              fallback={<NoAccess />}
            >
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
            <RoleGuard
              permission={{ module: "salary", action: "write" }}
              fallback={<NoAccess />}
            >
              <SalariesManage />
            </RoleGuard>
          }
        />
        <Route path="documents" element={<Documents />} />
        <Route path="tasks" element={<MyTasks />} />
        <Route path="projects" element={<MyProjects />} />
        <Route path="projects/new" element={<CreateProject />} />
        <Route path="projects/:id" element={<ProjectDetails />} />
        <Route path="projects/:id/tasks" element={<ProjectTasks />} />
        <Route path="tasks/:id" element={<TaskDetails />} />
        <Route
          path="projects/:id/tasks/new"
          element={
            <RoleGuard
              permission={{ module: "tasks", action: "write" }}
              fallback={<NoAccess />}
            >
              <CreateTask />
            </RoleGuard>
          }
        />
        <Route path="announcements" element={<Announcements />} />
        <Route path="holidays" element={<HolidaysPage />} />
        <Route path="reimbursements" element={<EmployeeReimbursements />} />
        <Route path="reimbursements/new" element={<ReimbursementRequest />} />
        <Route
          path="expenses"
          element={
            <RoleGuard
              permission={{ module: "finance", action: "write" }}
              fallback={<NoAccess />}
            >
              <Expenses />
            </RoleGuard>
          }
        />
        <Route
          path="invoices"
          element={
            <RoleGuard
              permission={{ module: "finance", action: "read" }}
              fallback={<NoAccess />}
            >
              <Invoices />
            </RoleGuard>
          }
        />
        <Route
          path="invoices/:id"
          element={
            <RoleGuard
              permission={{ module: "finance", action: "read" }}
              fallback={<NoAccess />}
            >
              <InvoiceDetails />
            </RoleGuard>
          }
        />
        <Route path="kras" element={<EmployeeKRAs />} />
        <Route
          path="kras/team"
          element={
            <RoleGuard sub={["manager", "hr"]} fallback={<NoAccess />}>
              <KRATeam />
            </RoleGuard>
          }
        />
        <Route path="profile" element={<Profile />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
