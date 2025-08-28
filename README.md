# HRMS Monorepo Starter (MERN + React + Tailwind + RBAC)

Monorepo with role-based auth and different post-login layouts for Superadmin, Admin, and Employee (with sub-roles: hr, manager, plain).

## Structure

```
hrms-monorepo/
  apps/
    api/        # Express + MongoDB + JWT auth
    web/        # React + Vite + Tailwind
```

## Quickstart

```bash
# at repo root
npm install

# set API env
cp apps/api/.env.example apps/api/.env

# run API and Web together
npm run dev
```

Seed a superadmin in another terminal:

```bash
curl -X POST http://localhost:4000/seed/superadmin   -H 'Content-Type: application/json'   -d '{"name":"Super Admin","email":"superadmin@hrms.dev","password":"password"}'
```

Log in at http://localhost:5173 with:

- Email: superadmin@hrms.dev
- Password: password

## Email (SMTP)

To enable email notifications (e.g., on leave requests), configure SMTP in `apps/api/.env`:

```
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-username
SMTP_PASS=your-smtp-password
SMTP_FROM=HRMS <no-reply@yourdomain.com>
```

If SMTP is not configured, the server will skip sending emails and log a warning.
