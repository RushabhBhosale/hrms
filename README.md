# HRMS Monorepo (MERN + React + Tailwind + RBAC)

Role‑based HRMS with attendance, leave management, projects/tasks, and reports. Ships as an npm workspaces monorepo with separate API (Express/MongoDB) and Web (React/Vite) apps, plus sensible defaults for first‑time setup.

## Overview

- Robust RBAC: primary roles (SUPERADMIN, ADMIN, EMPLOYEE) and company‑defined sub‑roles (e.g., hr, manager, developer).
- Attendance & Reports: daily punches, monthly view, Excel export, and auto punch‑out safeguard.
- Leave Management: requests, approvals, company leave policy, bank holidays, balances sync.
- Projects & Tasks: team projects, assignments, comments, and time logging with daily safety cap.
- Documents: employee uploads and admin review.
- Email Notifications: optional SMTP integration for leaves, projects, and tasks.

## Tech Stack

- API: Express, Mongoose (MongoDB), JWT, Multer, Nodemailer, ExcelJS
- Web: React 18, Vite 5, Tailwind CSS, React Router, Axios
- Tooling: npm workspaces, `concurrently`

## Monorepo Structure

```
.
├── apps/
│   ├── api/  # Express + MongoDB API
│   └── web/  # React + Vite frontend
├── package.json  # workspaces + root scripts
└── README.md
```

Relevant entry points and config:

- `apps/api/src/index.js:1` – Express app, routes, CORS, server start
- `apps/api/src/routes` – Feature routes (auth, companies, attendance, leaves, documents, projects)
- `apps/web/src/App.tsx:1` – Router with role‑based layouts
- `apps/web/src/lib/api.ts:1` – Axios client, `VITE_API_URL` support

## Prerequisites

- Node.js 18+ (Vite 5 and ESM tooling expect this)
- MongoDB running locally or reachable via `MONGO_URL`

## Quick Start

```bash
# at repo root
npm install

# copy API env and adjust values
cp apps/api/.env.example apps/api/.env

# run API and Web together (two terminals under the hood)
npm run dev
```

Seed a Super Admin in another terminal:

```bash
curl -X POST http://localhost:4000/seed/superadmin \
  -H 'Content-Type: application/json' \
  -d '{"name":"Super Admin","email":"superadmin@hrms.dev","password":"password"}'
```

Then log in at `http://localhost:5173` with:

- Email: `superadmin@hrms.dev`
- Password: `password`

## Configuration

### API environment (`apps/api/.env`)

Required:

- `MONGO_URL` – e.g., `mongodb://localhost:27017`
- `JWT_SECRET` – any strong secret
- `CLIENT_ORIGIN` – Web app origin (default dev is `http://localhost:5173`)

Optional:

- `PORT` – API port (default `4000`)
- `AUTO_PUNCH_OUT_TIME` – HH:mm (24h) for auto punch‑out job (defaults to `08:30`)
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` – enable email
- `SMTP_DEBUG` – set `true` to log SMTP debug output

SMTP notes: If unset, emails are skipped with a warning. For Gmail, prefer `SMTP_USER` as the From address; `SMTP_FROM` display name is preserved (see `apps/api/src/utils/mailer.js:1`).

### Web environment (`apps/web`)

Optional `.env` with:

- `VITE_API_URL` – API base URL (defaults to `http://localhost:4000`)

## First‑Time Setup (Product Flow)

1. Log in as Super Admin and add a company: `Super Admin → Companies → Add` (`/superadmin/companies/add`).
2. The flow creates the company and its Admin. Admin then manages employees, roles, leave policy, bank holidays, and projects.
3. Employees log into `/app`, punch in/out, request leaves, upload documents, and log task time.

## Running & Scripts

- `npm run dev` – runs API and Web together
- `npm run start -w apps/api` – runs API only (prod mode)
- `npm run dev -w apps/api` – API with nodemon
- `npm run dev -w apps/web` – Web dev server (Vite)
- `npm run build` – builds both apps; use `npm run build -w apps/web` for web only
- `npm run preview -w apps/web` – serve built web locally

## Key Features & Concepts

### Roles & Access

- Primary roles: `SUPERADMIN`, `ADMIN`, `EMPLOYEE` (enforced in API and Web guards)
- Sub‑roles: company‑defined labels (e.g., `hr`, `manager`, `developer`) used for extra access in views like attendance and reports
- Guards: see `apps/web/src/components/RoleGuard.tsx:1` and `apps/api/src/middleware/roles.js:1`

### Attendance

- Punch in/out: `POST /attendance/punch` with `{ action: "in" | "out" }`
- Today: `GET /attendance/today`
- History: `GET /attendance/history/:employeeId?` (self or, for admin/hr/manager, others)
- Monthly reports: `GET /attendance/monthly/:employeeId?` with `?month=yyyy-mm`
- Excel export: `GET /attendance/monthly/:employeeId/excel?month=yyyy-mm`
- Admin company views: `GET /attendance/company/*` (today, history, aggregate report)

Auto punch‑out job: at `AUTO_PUNCH_OUT_TIME` (default 08:30) the server closes “open” records from yesterday, marks `autoPunchOut: true` and adds time up to the configured time (`apps/api/src/jobs/autoPunchOut.js:1`).

### Leave Management

- Employee requests: `POST /leaves` (type, start/end, reason, optional notify list)
- Approvals: reporting person or admin approves/rejects (`/leaves/:id/approve` or `/reject`)
- Company leaves today: `GET /leaves/company/today`
- Balances are initialized/synced from company policy on login (`apps/api/src/utils/leaveBalances.js:1`)
- Admin manages leave policy and bank holidays under Companies routes

Simplified Policy (Total + Type Caps):

- Admin sets a total annual leave pool and a global monthly accrual rate.
- Admin divides the total into caps for Paid, Casual, and Sick; leave is untyped until consumed.
- When an employee requests a leave, they select the type; approval checks the selected type's remaining cap and the employee’s total available pool.

### Projects & Tasks

- Admin creates projects, assigns team lead/members
- Members can create tasks, comment, and log time
- Time logs enforce a daily cap: total minutes ≤ (worked minutes today − 60) based on attendance (`apps/api/src/routes/projects.js:1`)
- Personal project is automatically created per user for non‑project tasks

### Documents

- Employee uploads files via `POST /documents` (multipart `documents[]`)
- Files are stored under `apps/api/uploads` and served at `/uploads/*`

### Email Notifications (optional)

- Sent for new leave requests, project assignments, and task assignments when SMTP is configured
- Non‑blocking: failures are logged but don’t break requests (`apps/api/src/utils/mailer.js:1`)

## Data Model (Brief)

- Employee: identity, roles, company, reporting person, leave balances, bank details, documents (`apps/api/src/models/Employee.js:1`)
- Company: admin, roles (sub‑roles), leave policy, bank holidays (`apps/api/src/models/Company.js:1`)
- Attendance: per‑day punches and worked time (`apps/api/src/models/Attendance.js:1`)
- Leave: requests with type, period, status (`apps/api/src/models/Leave.js:1`)
- Project/Task: assignments, comments, time logs (`apps/api/src/models/Project.js:1`, `apps/api/src/models/Task.js:1`)

## Production Notes

- Web: `npm run build -w apps/web` → deploy `apps/web/dist` to static hosting
- API: set all env values and run `npm run start -w apps/api` behind a process manager (PM2/systemd)
- CORS: ensure `CLIENT_ORIGIN` matches your deployed web URL

## Troubleshooting

- Can’t log in: seed Super Admin and ensure Mongo is reachable
- CORS errors: update `CLIENT_ORIGIN` in API `.env` to your web origin
- Emails not sending: verify `SMTP_HOST`, credentials, and that provider allows SMTP; use `SMTP_DEBUG=true`
- Excel export fails: check date format `?month=yyyy-mm` and auth permissions
