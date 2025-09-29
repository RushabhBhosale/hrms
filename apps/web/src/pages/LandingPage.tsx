import { Link } from "react-router-dom";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-bg text-text">
      <header className="sticky top-0 z-30 bg-surface/70 backdrop-blur border-b border-border">
        <div className="mx-auto max-w-6xl px-4 h-16 flex items-center justify-between">
          <Link to="/" className="text-xl font-extrabold tracking-wide">
            <img src="/peracto_logo.png" className="w-[170px]" />
          </Link>
          <nav className="hidden md:flex items-center gap-6 text-sm">
            <a href="#features" className="hover:text-text">
              Features
            </a>
            <a href="#how-it-works" className="hover:text-text">
              How it works
            </a>
            <a href="#pricing" className="hover:text-text">
              Pricing
            </a>
            <a href="#faq" className="hover:text-text">
              FAQ
            </a>
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <Link
              to="/login"
              className="inline-flex h-9 items-center justify-center rounded-md px-3 border border-border hover:bg-bg"
            >
              Login
            </Link>
            <Link
              to="/register-company"
              className="inline-flex h-9 items-center justify-center rounded-md px-3 bg-primary text-white"
            >
              Get Started
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-4 py-14 md:py-20 grid md:grid-cols-2 gap-10 items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted">
              <span className="h-2 w-2 rounded-full bg-primary"></span>
              Go live in minutes with RBAC
            </div>
            <h1 className="mt-4 text-4xl md:text-5xl font-extrabold leading-tight">
              All-in-one HRMS for modern teams
            </h1>
            <p className="mt-4 text-lg text-muted max-w-prose">
              Attendance, leaves, payroll, projects, and documents in a clean,
              fast workflow. Built for small teams, scalable for enterprises.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                to="/register-company"
                className="inline-flex h-11 items-center justify-center rounded-md px-5 bg-primary text-white"
              >
                Start free
              </Link>
              <a
                href="#features"
                className="inline-flex h-11 items-center justify-center rounded-md px-5 border border-border hover:bg-bg"
              >
                Explore features
              </a>
            </div>
            <div className="mt-6 grid grid-cols-3 gap-4 text-center">
              <Stat value="3" label="Core roles" />
              <Stat value="6+" label="Modules" />
              <Stat value="< 5m" label="Setup time" />
            </div>
          </div>
          <div className="relative">
            <div className="rounded-xl border border-border bg-white shadow-sm p-4">
              <div className="h-56 md:h-72 rounded-lg border border-border bg-gradient-to-br from-bg to-white grid place-items-center">
                <span className="text-muted text-sm">
                  Drop a dashboard screenshot/illustration here
                </span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <Badge>RBAC</Badge>
                <Badge>Attendance</Badge>
                <Badge>Leaves</Badge>
                <Badge>Payroll</Badge>
                <Badge>Projects</Badge>
                <Badge>Reports</Badge>
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="bg-surface/50 border-y border-border">
          <div className="mx-auto max-w-6xl px-4 py-12 md:py-16">
            <SectionTitle
              title="Features that cover the full employee lifecycle"
              subtitle="Everything you need. Nothing you don’t."
            />
            <div className="mt-8 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              <Feature
                title="RBAC & sub-roles"
                desc="SUPERADMIN, ADMIN, EMPLOYEE with company-defined sub-roles for granular control."
              />
              <Feature
                title="Attendance"
                desc="Punch in/out, monthly view, Excel export, and auto punch-out safeguard."
              />
              <Feature
                title="Leaves"
                desc="Requests, approvals, balances synced to policy, bank holidays."
              />
              <Feature
                title="Payroll-ready"
                desc="Clean exports and slip generation hooks powered by ExcelJS."
              />
              <Feature
                title="Projects & Tasks"
                desc="Assignments, comments, time logs with daily safety cap."
              />
              <Feature
                title="Documents"
                desc="Employee uploads with admin review and secure access."
              />
            </div>
          </div>
        </section>

        <section
          id="how-it-works"
          className="mx-auto max-w-6xl px-4 py-12 md:py-16"
        >
          <SectionTitle
            title="From zero to HR ready in three steps"
            subtitle="Streamlined product flow baked in."
          />
          <ol className="mt-8 grid md:grid-cols-3 gap-6">
            <Step
              num="1"
              title="Register company"
              desc="Create your company and admin in one form."
              cta="Register"
              to="/register-company"
            />
            <Step
              num="2"
              title="Configure essentials"
              desc="Add employees, roles, leave policy, bank holidays."
            />
            <Step
              num="3"
              title="Start using the app"
              desc="Employees punch time, request leaves, and log tasks."
              cta="Login"
              to="/login"
            />
          </ol>
        </section>

        {/* <section id="pricing" className="bg-surface/50 border-y border-border">
          <div className="mx-auto max-w-6xl px-4 py-12 md:py-16">
            <SectionTitle
              title="Simple pricing"
              subtitle="Start free. Upgrade when you scale."
            />
            <div className="mt-8 grid md:grid-cols-3 gap-6">
              <Plan
                name="Starter"
                price="₹0"
                blurb="For small teams getting started"
                features={[
                  "Up to 10 employees",
                  "Attendance & Leaves",
                  "Projects & Documents",
                  "Email notifications (optional SMTP)",
                ]}
                cta="Start free"
                to="/register-company"
              />
              <Plan
                name="Growth"
                price="₹999/mo"
                highlight
                blurb="For growing companies"
                features={[
                  "Up to 100 employees",
                  "Advanced reports",
                  "Priority support",
                  "Custom roles",
                ]}
                cta="Choose Growth"
                to="/register-company"
              />
              <Plan
                name="Enterprise"
                price="Contact"
                blurb="For large organizations"
                features={[
                  "Unlimited employees",
                  "SLA support",
                  "SSO & audit logs",
                  "Custom integrations",
                ]}
                cta="Contact sales"
                to="/register-company"
              />
            </div>
          </div>
        </section> */}

        <section id="faq" className="mx-auto max-w-4xl px-4 py-12 md:py-16">
          <SectionTitle
            title="FAQ"
            subtitle="Quick answers to common questions"
          />
          <div className="mt-6 space-y-3">
            <FAQ
              q="How long does setup take?"
              a="Most teams are live in under 5 minutes using the built-in product flow."
            />
            <FAQ
              q="Do I need SMTP configured?"
              a="No. Email is optional. If not configured, actions still succeed and log warnings."
            />
            <FAQ
              q="Can I export data?"
              a="Yes. Attendance monthly reports export to Excel. Other exports can be added easily."
            />
            <FAQ
              q="Does it support sub-roles?"
              a="Yes. Add company-specific sub-roles like hr, manager, developer for granular views."
            />
          </div>
          <div className="mt-8 text-center">
            <Link
              to="/register-company"
              className="inline-flex h-11 items-center justify-center rounded-md px-6 bg-primary text-white"
            >
              Create your company
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-border py-8 text-center text-sm text-muted">
        © {new Date().getFullYear()} HRMS — All rights reserved.
      </footer>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border border-border bg-white px-2.5 py-1 text-xs">
      {children}
    </span>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg border border-border bg-white p-4">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-muted mt-1">{label}</div>
    </div>
  );
}

function SectionTitle({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl md:text-3xl font-bold">{title}</h2>
      {subtitle ? <p className="mt-2 text-muted">{subtitle}</p> : null}
    </div>
  );
}

function Feature({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="rounded-xl border border-border bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <Dot />
        <h3 className="font-semibold">{title}</h3>
      </div>
      <p className="mt-2 text-sm text-muted">{desc}</p>
    </div>
  );
}

function Step({
  num,
  title,
  desc,
  cta,
  to,
}: {
  num: string;
  title: string;
  desc: string;
  cta?: string;
  to?: string;
}) {
  return (
    <li className="rounded-xl border border-border bg-white p-5">
      <div className="h-8 w-8 rounded-full bg-primary/10 text-primary grid place-items-center font-bold">
        {num}
      </div>
      <h3 className="mt-3 font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-muted">{desc}</p>
      {cta && to ? (
        <div className="mt-3">
          <Link
            to={to}
            className="inline-flex h-9 items-center justify-center rounded-md px-3 border border-border hover:bg-bg"
          >
            {cta}
          </Link>
        </div>
      ) : null}
    </li>
  );
}

function Plan({
  name,
  price,
  blurb,
  features,
  cta,
  to,
  highlight,
}: {
  name: string;
  price: string;
  blurb: string;
  features: string[];
  cta: string;
  to: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-6 shadow-sm ${
        highlight ? "border-primary bg-white" : "border-border bg-white"
      }`}
    >
      <div className="flex items-baseline justify-between">
        <h3 className="text-lg font-semibold">{name}</h3>
        {highlight ? (
          <span className="text-xs rounded-full bg-primary text-white px-2 py-0.5">
            Popular
          </span>
        ) : null}
      </div>
      <div className="mt-2 text-3xl font-extrabold">
        {price}
        <span className="text-base font-medium text-muted">
          {price === "Contact" ? "" : "/mo"}
        </span>
      </div>
      <p className="mt-2 text-sm text-muted">{blurb}</p>
      <ul className="mt-4 space-y-2 text-sm">
        {features.map((f) => (
          <li key={f} className="flex items-center gap-2">
            <Check16 />
            {f}
          </li>
        ))}
      </ul>
      <Link
        to={to}
        className="mt-5 w-full inline-flex h-10 items-center justify-center rounded-md bg-primary text-white"
      >
        {cta}
      </Link>
    </div>
  );
}

function FAQ({ q, a }: { q: string; a: string }) {
  return (
    <details className="rounded-lg border border-border bg-white p-4">
      <summary className="cursor-pointer list-none font-medium">{q}</summary>
      <p className="mt-2 text-sm text-muted">{a}</p>
    </details>
  );
}

function Dot() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="text-primary"
    >
      <circle cx="12" cy="12" r="6" />
    </svg>
  );
}

function Check16() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path
        d="M20 6L9 17l-5-5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
