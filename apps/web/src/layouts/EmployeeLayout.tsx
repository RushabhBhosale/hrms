import { Outlet, NavLink, useLocation, useNavigate } from "react-router-dom";
import { clearAuth, getEmployee } from "../lib/auth";
import { useEffect, useMemo, useState } from "react";
import {
  Home,
  Clock8,
  CalendarCheck2,
  LogOut,
  Menu,
  X,
  User,
  FileText,
  ClipboardList,
  Users,
} from "lucide-react";

export default function EmployeeLayout() {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const u = getEmployee();

  const [desktopOpen, setDesktopOpen] = useState(true); // collapse on md+
  const [mobileOpen, setMobileOpen] = useState(false); // drawer on <md
  useEffect(() => setMobileOpen(false), [pathname]); // auto-close drawer on route change

  const links = [
    { to: "/app", label: "Dashboard", icon: Home },
    ...(u?.subRoles?.some((r) => ["hr", "manager"].includes(r))
      ? []
      : [{ to: "/app/attendance", label: "Attendance", icon: Clock8 }]),

    { to: "/app/leave", label: "Leave", icon: CalendarCheck2 },
    { to: "/app/approvals", label: "Approvals", icon: ClipboardList },
    { to: "/app/documents", label: "Documents", icon: FileText },
    { to: "/app/profile", label: "Profile", icon: User },
  ];

  // if HR or Manager → add "Attendances"
  if (u?.subRoles?.some((r) => ["hr", "manager"].includes(r))) {
    links.splice(1, 0, {
      to: "/app/attendances",
      label: "Attendances",
      icon: Users,
    });
  }

  const title = useMemo(() => {
    if (pathname === "/app") return "Dashboard";
    if (pathname.startsWith("/app/attendances")) return "Attendances";
    if (pathname.startsWith("/app/attendance")) return "Attendance";
    if (pathname.startsWith("/app/leave")) return "Leave";
    if (pathname.startsWith("/app/approvals")) return "Leave Approvals";
    if (pathname.startsWith("/app/documents")) return "Documents";
    if (pathname.startsWith("/app/profile")) return "Profile";
    return "Employee";
  }, [pathname]);

  const SidebarInner = ({ compact = false }: { compact?: boolean }) => (
    <div className={`flex h-full ${compact ? "w-16" : "w-60"} transition-all`}>
      <div className="flex flex-col w-full">
        {/* Brand */}
        <div className="flex items-center justify-between px-4 h-14 border-b border-border">
          <div
            className={`font-bold text-sidebar-active tracking-wide ${
              compact ? "text-sm" : "text-lg"
            }`}
          >
            HRMS
          </div>
        </div>

        {/* Nav */}
        <nav
          className="flex-1 overflow-y-auto px-2 py-3 space-y-1"
          role="navigation"
          aria-label="Primary"
        >
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                [
                  "flex items-center gap-3 rounded-md px-3 py-2 transition",
                  pathname === to || pathname.startsWith(to)
                    ? "bg-primary/10 text-sidebar-active font-semibold"
                    : "hover:bg-sidebar-hover",
                ].join(" ")
              }
              title={label}
            >
              <Icon size={18} />
              {!compact && <span className="truncate">{label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* User / Logout */}
        <div className="border-t border-border p-3">
          <div className="flex items-center gap-2 mb-2 text-sidebar-active">
            <User size={16} />
            {!compact && (
              <div className="truncate">
                <div className="text-sm font-medium">
                  {u?.name || "Employee"}
                </div>
                <div className="text-xs text-muted truncate">
                  {u?.subRoles?.join(", ") || "—"}
                </div>
              </div>
            )}
          </div>
          <button
            onClick={() => {
              clearAuth();
              nav("/login");
            }}
            className="w-full inline-flex items-center justify-start gap-2 text-accent hover:text-secondary underline"
          >
            <LogOut size={16} />
            {!compact && "Logout"}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-bg text-text">
      {/* Mobile overlay */}
      <div
        className={`fixed inset-0 bg-black/40 z-40 md:hidden transition-opacity ${
          mobileOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setMobileOpen(false)}
      />

      <div className="flex">
        {/* Desktop sidebar (in-flow + sticky) */}
        <aside
          className="hidden md:block bg-sidebar-bg text-sidebar-text border-r border-border shadow-sm sticky top-0 h-screen"
          aria-label="Sidebar"
        >
          <SidebarInner compact={!desktopOpen} />
        </aside>

        {/* Mobile drawer */}
        <aside
          className={`md:hidden fixed top-0 left-0 z-50 h-full bg-sidebar-bg text-sidebar-text border-r border-border shadow-sm
                      transform transition-transform ${
                        mobileOpen ? "translate-x-0" : "-translate-x-full"
                      }`}
          aria-label="Mobile Sidebar"
        >
          <div className="flex items-center justify-between px-4 h-14 border-b border-border">
            <div className="font-bold text-sidebar-active tracking-wide">
              HRMS
            </div>
            <button
              className="inline-flex items-center justify-center h-9 w-9 rounded-md border border-border bg-sidebar-bg"
              onClick={() => setMobileOpen(false)}
              aria-label="Close sidebar"
            >
              <X size={18} />
            </button>
          </div>
          <div className="h-[calc(100%-3.5rem)]">
            <SidebarInner compact={false} />
          </div>
        </aside>

        {/* Main column */}
        <div className="flex-1 grid grid-rows-[auto_1fr] min-h-screen">
          {/* Top bar */}
          <header className="sticky top-0 z-30 bg-surface border-b border-border shadow-sm">
            <div className="h-16 px-3 md:px-6 flex items-center gap-3">
              {/* Mobile: open drawer */}
              <button
                onClick={() => setMobileOpen(true)}
                className="md:hidden inline-flex items-center justify-center h-9 w-9 rounded-md border border-border bg-surface"
                aria-label="Open sidebar"
                aria-expanded={mobileOpen}
              >
                <Menu size={18} />
              </button>

              {/* Desktop: collapse sidebar */}
              <button
                onClick={() => setDesktopOpen((v) => !v)}
                className="hidden md:inline-flex items-center justify-center h-9 w-9 rounded-md border border-border bg-surface hover:bg-bg"
                aria-label={desktopOpen ? "Collapse sidebar" : "Expand sidebar"}
              >
                ☰
              </button>

              <h1 className="text-lg md:text-xl font-semibold">{title}</h1>
            </div>
          </header>

          {/* Main content */}
          <main id="main" className="p-4 md:p-8 bg-bg">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
