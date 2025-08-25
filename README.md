# HRMS Monorepo Starter (MERN + React + Tailwind + RBAC)

Monorepo with role-based auth and different post-login layouts for Superadmin, Admin, and User (with sub-roles: hr, manager, plain).

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
curl -X POST http://localhost:4001/seed/superadmin   -H 'Content-Type: application/json'   -d '{"name":"Super Admin","email":"superadmin@hrms.dev","password":"password"}'
```

Log in at http://localhost:5173 with:

- Email: superadmin@hrms.dev
- Password: password
