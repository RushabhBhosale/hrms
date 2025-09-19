# HRMS Platform – In-Depth Developer & Operator Guide

_This document serves as a comprehensive, single-stop reference for understanding the HRMS monorepo. It covers the application architecture, libraries, domain models, API surface area, front-end workflows, and every notable user interaction. Use it as a primer for onboarding or as a reference when extending the system._

---

## 1. Repository Layout & Technologies

```
hrms/
├── package.json               # Monorepo entry point
├── docs/                      # Project documentation
├── apps/
│   ├── api/                   # Express + MongoDB back end
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── index.js       # Express bootstrap
│   │   │   ├── config.js      # Mongo connection, env helpers
│   │   │   ├── middleware/    # Auth, role guards
│   │   │   ├── models/        # Mongoose schemas (Employee, Expense, etc.)
│   │   │   ├── routes/        # REST endpoints
│   │   │   └── utils/         # Mailer, helpers
│   └── web/                   # React + Vite front end
│       ├── package.json
│       ├── src/
│       │   ├── pages/         # Route components (admin, employee, etc.)
│       │   ├── layouts/       # Shared shells for roles
│       │   ├── components/    # UI widgets, guards
│       │   └── lib/           # Axios API wrapper, auth helpers
└── docs/                      # Additional documentation
```

**Core Technologies**

- **Backend:** Node.js, Express, MongoDB (Mongoose ODM), JSON Web Tokens, PDFKit, ExcelJS, Nodemailer, Multer
- **Frontend:** React 18, TypeScript, Vite, Tailwind CSS, Recharts, Axios, React Router v6
- **Dev Tooling:** Concurrently (dual dev servers), Nodemon, ESLint (optional), TypeScript for the web app

---

## 2. Authentication & Roles

### Account Types

| Primary Role  | Purpose                                        | Default Access                           |
|---------------|------------------------------------------------|-------------------------------------------|
| `SUPERADMIN`  | Oversees platform, seeds companies              | Access to Super Admin portal              |
| `ADMIN`       | Manages a single company                        | Full admin suite & HR responsibilities    |
| `EMPLOYEE`    | Standard staff member                           | Employee portal (with sub-role gating)    |

### Sub Roles

- `hr` – Grants HR-level privileges (e.g., expenses, salary, attendance overrides)
- `manager` – Expanded access for team leads
- `developer`, `designer`, `qa` – Informational labels that appear in UI listings

### Auth Flow

1. **Company/Tenant Creation** – Via `/register-company`, seeds admin credentials.
2. **Login (`/login`)** – Credentials -> JWT stored in `localStorage`.
3. **Axios Configuration** – `src/lib/api.ts` injects `Authorization: Bearer <token>`.
4. **Route Guards** –
   - `<Protected>` verifies token presence.
   - `<RoleGuard>` enforces primary + sub role requirements.
5. **Logout** – Clears token and user cache; redirects to `/login`.

---

## 3. Backend Services (Express API)

### Common Middleware

- `auth` – Decodes JWT, populates `req.employee`.
- `requirePrimary([...])` – Ensures primary role is allowed.
- `requireAnySub([...])` – Checks sub-roles (e.g., HR access).
- `multer` – Handles document and attachment uploads to `/uploads`.

### Key Models (Mongoose)

- `Employee` – User profile, credentials, roles, bank info, encrypted fields.
- `Company` – Branding, roles, leave policies, working hours.
- `Attendance`, `AttendanceOverride` – Daily punching, overrides.
- `Leave` – Requests, approvals, balances.
- `Project`, `Task` – Project management + assignment data.
- `Invoice` – Receivables/payables with line items, PDF generation support. 
- `Expense`, `ExpenseCategory` – Expense tracking with recurring settings and vouchers.
- `SalaryTemplate`, `SalarySlip` – Payroll templates and generated slips.
- `Counter` – Generic key/value counters (e.g., invoice numbers, voucher numbers).

### Major Route Groups

| Route            | Description                                                                                                       |
|------------------|-------------------------------------------------------------------------------------------------------------------|
| `/auth`          | Login, password management                                                                                        |
| `/companies`     | Company CRUD, branding, employee listings                                                                         |
| `/attendance`    | Punch in/out, company/employee attendance, overrides                                                              |
| `/leaves`        | Submit, approve, list leaves                                                                                      |
| `/projects`      | Project CRUD, assign members, task management                                                                     |
| `/tasks`         | Task creation, status updates                                                                                     |
| `/invoices`      | Receivable/payable CRUD, PDF & Excel exports, email notifications                                                 |
| `/expenses`      | Expense categories, CRUD, recurring logic, voucher PDFs                                                           |
| `/finance`       | Aggregated dashboard metrics (invoice stats, recurring spend trend, breakdowns, upcoming reminders)              |
| `/salary`        | Templates, salary slips, payroll processing                                                                       |
| `/announcements` | Company news broadcast                                                                                            |
| `/seed`          | Seeding utilities (`/seed/superadmin`, `/seed/dummy`, `/seed/finance`)                                             |

**Notable New Logic (Vouchers)**

- Expense creation can generate a voucher number (scoped by month + company).
- PDF vouchers stored in `/uploads` via PDFKit.
- Updates allow toggling off recurring or vouchers, with file cleanup + regen.
- `/expenses` GET returns `hasVoucher` and nested `voucher` metadata for UI.

---

## 4. Front-End Architecture (React/Vite)

### Global State & Utilities

- `src/lib/api.ts` – Axios instance, attaches JWT from `localStorage`.
- `src/lib/auth.ts` – Helper to set/get/clear `Employee` from storage.
- `src/components/Protected.tsx` – Redirects unauthenticated users.
- `src/components/RoleGuard.tsx` – Enforces primary/sub role access per route tree.
- `src/layouts` – Shells for role-based navigation (Super Admin, Admin, Employees).

### Routing Structure (`src/App.tsx`)

Key route trees:
- `/` – Landing
- `/login`, `/forgot-password`, `/reset-password`
- `/register-company`
- `/superadmin/*`
- `/admin/*`
- `/app/*` – Employee portal

The admin and employee trees reuse many pages but with guards. Example: `/app/invoices` requires the `hr` sub-role even for employees.

---

## 5. Front-End Modules & UI Interactions (Detailed)

### 5.1 Dashboard (Admin)

File: `src/pages/admin/Dashboard.tsx`

**Sections:**
1. **Time Worked** – Shows current day’s punch-in/out state, live counter, punch buttons.
2. **Quick Stats** – Employee counts, attendance number.
3. **Financial Overview** (powered by `/finance/dashboard`):
   - Metric cards: invoices issued, outstanding/overdue, YTD/MTD expenses, recurring spend.
   - Upcoming recurring table: next 30 days, amounts, status.
   - Charts (Recharts):
     - Upcoming spend bar chart (date vs amount)
     - Recurring vs one-time pie chart
     - Recurring trend line (last 6 months)
4. **Project Time Analytics** – `<ProjectTime>` component summarizing time logs.
5. **Project Assignments Table** – Searchable/paginatable employee-to-project view.

Each widget uses `load()` to fetch employees, attendance, active projects, leave statuses, and finance metrics concurrently.

**Buttons & Interactions:**
- “Punch In/Out”: POST `/attendance/punch`.
- “Refresh” (attendance & finance): re-fetch data.
- Finance modal buttons open a detail view for upcoming expenses in place; no additional modals here.

### 5.2 Expenses (Admin HR)

File: `src/pages/admin/Expenses.tsx`

**Form Fields:**
- Date, Category, Description, Notes, Amount, Paid By
- Attachments (multiple uploads)
- Recurring toggle (frequency, start date, reminders, next due preview)
- Voucher toggle (Authorized By, handles voucher generation)

**Behavior:**
- Uses FormData to POST or PUT `/expenses` with attachments and toggles.
- Voucher logic adds `voucherEnabled` and `voucherAuthorizedBy` (server generates numbers & PDFs).
- Reset button clears form and attachments.

**Categories box:** Inline add/remove with `/expenses/categories` endpoints.

**Tracked Expenses table:** (condensed columns: Date, Category, Amount, Paid by, Recurring flag, Actions)
- “View” – Opens detail modal with full info (description, notes, recurring timings, voucher metadata, attachments)
- “Print” – Opens printable window (HTML template)
- “Edit” – Loads form with existing values (description, voucher status, etc.)
- “Delete” – DELETE `/expenses/:id`
- “End Recurring” – Displays if expense is recurring; sends `isRecurring=false` to terminate series.

**Detail Modal:**
- Displays everything: description, notes, recurring schedule, voucher metadata, attachments.
- Buttons: Close, End Recurring (if active), Edit.

### 5.3 Invoices (Admin, HR)

File: `src/pages/admin/Invoices.tsx`

**Main Pane:**
- Filters by type (receivable/payable), status, search, date ranges, amounts, sorting.
- Table (condensed to key fields) with row actions:
  - “Open” – navigates to invoice detail route.
  - “Download JSON” – exports invoice payload.
  - “Generate PDF” – triggers server PDF creation & download.
  - “Email” – send invoice to party (if email set).
- Floating panel for creating invoices with line items, status selection, notes.
- Task-to-line-item helper includes project tasks filtering and default rate settings.

**Secondary Views:**
- Invoice details route shows full invoice with print, PDF download, change status, resend email, etc.

### 5.4 Salary Management

- `SalaryTemplate.tsx` – CRUD for payroll templates.
- `SalarySlips.tsx` (Admin) – Generate & download salary slips; send to employees.
- `SalarySlip.tsxx` (Employee) – Individual slip view with download.
- `SalariesManage.tsx` (Employee/HR) – Manage salary records, adjust allowances/deductions.

### 5.5 Attendance & Leave Apps

- Admin pages: `AttendanceRecords`, `LeaveRequests`, `LeaveSettings`, `CompanyTiming`.
- Employee pages: `AttendanceRecords` (view own), `LeaveRequest`, `LeaveApprovals` (for managers), etc.
- Buttons: punch in/out, apply leave (select type, date range), approve/deny, override.

### 5.6 Projects & Tasks

- `Projects.tsx` (Admin) – Create projects (with team leads/members), view total vs spent time, toggle active status.
- `MyProjects.tsx` (Employee/HR) – HR & managers can create projects now; form akin to admin but with filtered lists for team leads.
- `ProjectDetails`, `ProjectTasks` – Task lists, status changes, logs.

### 5.7 Documents & Announcements

- `Documents.tsx` – Upload/view own documents; admin can view by employee.
- `Announcements(… )` – Admin HR can post announcements; employees view in portal; modal/popup appears on dashboards.

---
## 5.8 Finance Dashboard

- `/finance/dashboard` aggregates invoice counts, totals, outstanding, upcoming due amounts, expense breakdowns, recurring projections, and trend arrays for use in `Dashboard.tsx`.

## 5.9 Seed Utilities

- `POST /seed/superadmin` – Create SUPERADMIN.
- `POST /seed/dummy` – Seed sample company with employees, projects, tasks (optional reset).
- `POST /seed/finance` – Seed invoices & expenses (including recurring entries + voucher data).

---

## 6. Front-End Layouts & Navigation

### Layouts

- `SuperAdminLayout.tsx` – Top nav for company oversight.
- `AdminLayout.tsx` – Sidebar with Admin-specific modules (Employees, Projects, Expenses, Invoices, Salary, etc.).
- `EmployeeLayout.tsx` – Sidebar with dashboards, tasks, documents, HR-only sections gated by sub-role.

Each layout fetches company branding (`/companies/branding`) to display logos; includes `AnnouncementsPopup` overlays.

### UI Patterns

- **Tables** – Many tables now show minimal columns with detail modals (“View” button) to prevent overflow; modals include aggregated information and direct actions.
- **Modals** – For detailed inspection (expenses, invoices, etc.); closing resets `selected*` state.
- **Forms** – Controlled components with inline validation (`setFormError`).
- **Buttons & Icons** – Standard icons via `lucide-react`; action order: View → Print → Edit → Delete (+ End Recurring when applicable).

---

## 7. Expenses & Voucher Flow (Deep Dive)

1. **Add Expense** – Toggle “Generate Voucher”, provide “Authorized By”. Backend issues voucher number `VCH-YYYYMM-####`, generates PDF, returns metadata.
2. **Update Expense** – Toggling voucher off removes PDF + metadata; toggling on regenerates number/PDF. Editing “Authorized By” triggers PDF regeneration.
3. **Recurring Controls** – “End Recurring” sets `isRecurring=false` and clears schedule.
4. **Deletion** – Removes attachments + voucher PDF.
5. **Finance Dashboard** – Recurring entries feed upcoming spend table and charts.

---

## 8. Invoices (Deep Dive)

- Auto-numbering via `Counter` model, PDF/Excel exports, email notifications (if mail enabled).
- Invoice statuses (draft/sent/pending/paid/overdue) drive colored badges & metrics.
- `/invoices/:id/export/pdf` (handled within route) produces PDF using company branding and line item breakdowns.

---

## 9. Salary & Payroll

- Templates define earnings/deductions.
- HR generates salary slips and can email/download them.
- Employees fetch personal slips via `/app/salary-slip`.

---

## 10. Projects & Task Management

- HR (via employee portal) and Admin can create projects.
- Task creation restricted to project members (or global personal project).
- Time summaries power dashboard metrics via `/projects/:id/time-summary`.

---

## 11. Attendance & Leave Module

- Punching uses `/attendance/punch` with `action` payload.
- `AttendanceRecords` offers search/filter; admin view can export.
- Leave requests submitted/approved via `LeaveRequest`, `LeaveApprovals`, `LeaveRequests` pages.
- `LeaveSettings` configures allocation policies, accrual, caps.

---

## 12. Reporting & Analytics

- Finance charts (Recharts) visualize spend and trends in admin dashboard.
- Reports pages export monthly summaries for attendance, leaves, payroll.

---

## 13. File Storage & Downloads

- Upload directory: `apps/uploads` (served at `/uploads/<filename>`).
- Expenses store attachments + vouchers; invoices store generated PDFs.
- Deletion/update logic removes old files to avoid orphaned uploads.

---

## 14. Local Development & Commands

| Command                                   | Description                                         |
|-------------------------------------------|-----------------------------------------------------|
| `npm install`                             | Install root dependencies (monorepo)                |
| `npm run dev`                             | Run API + web concurrently                          |
| `npm run build`                           | Build API and web                                   |
| `npm run build -w apps/web`               | Build web only                                      |
| `npm run start`                           | Start API                                           |
| `npm run dev -w apps/api`                 | API dev server                                      |
| `npm run dev -w apps/web`                 | Web dev server                                      |

**Environment Variables** – configure via `apps/api/.env` (Mongo URI, JWT secret, mail settings, seed key, client origin, etc.).

---

## 15. Extending the System

1. Model changes → Add Mongoose schema, update indexes.
2. Routes → Register in `src/index.js` and implement CRUD with auth guards.
3. Front-end → Create pages/components, update layouts for navigation.
4. Files → Use existing upload dir; reuse `multer` configuration.
5. Authorization → Wrap routes with `RoleGuard` / primary role checks.

**Styling Tips** – Follow Tailwind patterns; prefer condensed table columns with modals for full info. Reuse `lucide-react` icons.

**Common Pitfalls** –
- Forgetting to clean uploads on delete/update (use `removeFiles` / `removeFileSafe`).
- Not updating counters per company when adding numbering features.
- Recharts requires type declaration (`src/types/recharts.d.ts`).
- Recurring expense logic must guard against past dates and infinite loops in `computeNextDue`.

---

## 16. Buttons & Actions Cheat Sheet

| Component/Page                | Action/Button        | Backend Interaction                                        |
|-------------------------------|----------------------|------------------------------------------------------------|
| Admin Dashboard               | Punch In/Out         | POST `/attendance/punch`                                   |
|                               | Refresh              | Re-fetch attendance/finance endpoints                      |
| Admin Expenses                | Save Expense         | POST `/expenses`                                           |
|                               | Reset                | Reset form state                                            |
|                               | Generate Voucher     | `voucherEnabled=true` in payload                           |
|                               | View                 | Opens detail modal                                         |
|                               | End Recurring        | PUT `/expenses/:id` (isRecurring=false)                    |
|                               | Print                | Browser print preview                                      |
|                               | Edit/Delete          | PUT / DELETE `/expenses/:id`                               |
| Admin Invoices                | Create Invoice       | POST `/invoices`                                           |
|                               | Open / PDF / Email   | `/admin/invoices/:id` and respective actions               |
| Admin Projects                | Create/Toggle        | POST / PUT `/projects`                                     |
| Attendance & Leaves           | Punch, Approve, etc. | Respective `/attendance`, `/leaves` endpoints              |
| Salary Templates / Slips      | Generate/Download    | `/salary` endpoints                                        |
| Announcements                 | Post Announcement    | POST `/announcements`                                      |
| Documents                     | Upload               | POST `/documents`                                          |

---

## 17. Deployment Checklist

- Configure `.env` with production Mongo, JWT, client origin.
- Ensure `/uploads` has read/write permissions.
- Consider mounting uploads or using S3 in production.
- Validate PDFKit dependencies installed on host.
- Watch cron jobs (if enabled) in `jobs` directory.

---

## 18. Quick Start for New Developers

1. `npm install` (root) + `npm install --workspace apps/web`.
2. Configure `apps/api/.env` (Mongo URI, JWT, etc.).
3. `npm run dev` (API @ :4000, web @ :5173).
4. Seed (optional):
   ```bash
   curl -X POST http://localhost:4000/seed/superadmin \
     -H "Content-Type: application/json" \
     -d '{"name":"Root","email":"root@example.com","password":"password123"}'

   curl -X POST http://localhost:4000/seed/dummy -H "Content-Type: application/json" -d '{"reset":true}'
   curl -X POST http://localhost:4000/seed/finance -H "Authorization: Bearer <token>" -d '{"reset":true}'
   ```
5. Log in as `admin@acme.test` / `password123` or create new admin.
6. Navigate the Admin sidebar then the Employee portal to verify flows.

---

## 19. FAQ & Troubleshooting

- **Uploads missing?** Check static route `app.use("/uploads", ...)` and permissions.
- **Finance data empty?** Ensure user is ADMIN/HR; verify company ObjectId.
- **Charts blank?** Install `recharts`, ensure TypeScript declaration exists.
- **Voucher PDF missing?** Check server logs for `voucher pdf create err`.
- **Recurring dates stuck?** Validate start date; `computeNextDueDate` handles rollovers.

---

## 20. Suggested Improvements

- Add automated tests (unit + integration) for critical modules.
- Introduce caching/state management (React Query) if API usage increases.
- Enhance finance analytics (budget vs actuals, ledger entries).
- Externalize uploads to cloud storage for scalability.
- Consider using templating libraries for PDF exports.

---

_Armed with this guide, a new developer should gain a complete mental model of the HRMS platform within minutes, accelerating onboarding and reducing ramp-up time._
