import { Outlet, NavLink, useLocation, useNavigate } from "react-router-dom";
import { clearAuth, getEmployee } from "../lib/auth";
import { useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard,
  UserPlus,
  Users,
  CalendarCheck2,
  ClipboardList,
  LogOut,
  Menu,
  X,
  User,
  Settings,
  UserCog,
  FileText,
  Clock,
} from "lucide-react";
import { Megaphone } from "lucide-react";
import AnnouncementsPopup from "../components/AnnouncementsPopup";

export default function AdminLayout() {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const u = getEmployee();

  const [desktopOpen, setDesktopOpen] = useState(true); // collapse on md+
  const [mobileOpen, setMobileOpen] = useState(false); // drawer on <md
  useEffect(() => setMobileOpen(false), [pathname]); // auto-close drawer

  const links = [
    { to: "/admin", label: "Dashboard", icon: LayoutDashboard },
    { to: "/admin/employees/add", label: "Add Employee", icon: UserPlus },
    { to: "/admin/employees", label: "Employee List", icon: Users },
    { to: "/admin/projects", label: "Projects", icon: ClipboardList },
    { to: "/admin/announcements", label: "Announcements", icon: Megaphone },
    { to: "/admin/company", label: "Company", icon: Settings },
    { to: "/admin/roles", label: "Roles", icon: UserCog },
    { to: "/admin/attendances", label: "Attendances", icon: CalendarCheck2 },
    { to: "/admin/report", label: "Report", icon: FileText },
    { to: "/admin/leave-settings", label: "Leave Settings", icon: Settings },
    { to: "/admin/company-timing", label: "Company Timing", icon: Clock },
    { to: "/admin/leaves", label: "Leave Requests", icon: ClipboardList },
    { to: "/admin/salary/template", label: "Salary Template", icon: FileText },
    { to: "/admin/salary/slips", label: "Salary Slips", icon: ClipboardList },
    { to: "/admin/profile", label: "Profile", icon: User },
  ];

  const title = useMemo(() => {
    if (pathname === "/admin") return "Dashboard";
    if (pathname.startsWith("/admin/employees/add")) return "Add Employee";
    if (pathname.startsWith("/admin/employees/")) return "Employee Details";
    if (pathname.startsWith("/admin/employees")) return "Employee List";
    if (pathname.startsWith("/admin/roles")) return "Roles";
    if (pathname.startsWith("/admin/projects")) return "Projects";
    if (pathname.startsWith("/admin/announcements")) return "Announcements";
    if (pathname.startsWith("/admin/company")) return "Company";
    if (pathname.startsWith("/admin/attendances")) return "Attendances";
    if (pathname.startsWith("/admin/leave-settings")) return "Leave Settings";
    if (pathname.startsWith("/admin/company-timing")) return "Company Timing";
    if (pathname.startsWith("/admin/report")) return "Report";
    if (pathname.startsWith("/admin/leaves")) return "Leave Requests";
    if (pathname.startsWith("/admin/salary/template")) return "Salary Template";
    if (pathname.startsWith("/admin/salary/slips")) return "Salary Slips";
    if (pathname.startsWith("/admin/profile")) return "Profile";
    return "Admin";
  }, [pathname]);

  const SidebarInner = ({ compact = false }: { compact?: boolean }) => (
    <div className={`flex h-full ${compact ? "w-16" : "w-60"} transition-all`}>
      <div className="flex flex-col w-full">
        {/* Brand */}
        <div
          className={`flex items-center ${
            compact ? "justify-center" : "justify-between"
          } h-[66px] border-b border-border`}
        >
          <div className={`font-bold text-sidebar-active tracking-wide`}>
            {compact ? (
              <img src="/logo.png" alt="logo" className="max-w-none size-12" />
            ) : (
              <img src="/logo-horizontal.png" alt="logo" className="size-32" />
            )}
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
              className={() => {
                const isActive = (() => {
                  if (to === "/admin") return pathname === "/admin";
                  if (to === "/admin/employees") {
                    return (
                      pathname.startsWith("/admin/employees") &&
                      !pathname.startsWith("/admin/employees/add")
                    );
                  }
                  return pathname === to || pathname.startsWith(to + "/");
                })();

                return [
                  "flex items-center gap-3 rounded-md px-3 py-2 transition",
                  isActive
                    ? "bg-primary/10 text-sidebar-active font-semibold"
                    : "hover:bg-sidebar-hover",
                ].join(" ");
              }}
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
            {!compact && <span className="truncate">{u?.name || "Admin"}</span>}
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
              HRMS Admin
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

              <div className="ml-auto flex items-center gap-3">
                <div className="hidden md:block">
                  <input
                    placeholder="Search…"
                    className="h-9 w-56 rounded-md border border-border bg-surface px-3 outline-none focus:ring-2 focus:ring-primary"
                    aria-label="Search"
                  />
                </div>
                <div className="h-9 px-3 rounded-md border border-border bg-surface text-muted flex items-center">
                  {u?.email || "admin@example.com"}
                </div>
              </div>
            </div>
          </header>

          {/* Main content */}
          <main id="main" className="p-4 md:p-8 bg-bg">
            <AnnouncementsPopup />
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
