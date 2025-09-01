import { Outlet, NavLink, useLocation, useNavigate } from "react-router-dom";
import { clearAuth, getEmployee } from "../lib/auth";
import { useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard,
  Building2,
  PlusCircle,
  LogOut,
  Menu,
  X,
  User,
} from "lucide-react";

export default function SuperAdminLayout() {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const u = getEmployee();

  const [desktopOpen, setDesktopOpen] = useState(true); // desktop collapse
  const [mobileOpen, setMobileOpen] = useState(false); // mobile drawer

  useEffect(() => setMobileOpen(false), [pathname]); // autoclose on nav

  const links = [
    { to: "/superadmin", label: "Dashboard", icon: LayoutDashboard },
    { to: "/superadmin/companies", label: "Companies", icon: Building2 },
    { to: "/superadmin/companies/add", label: "Add Company", icon: PlusCircle },
    { to: "/superadmin/profile", label: "Profile", icon: User },
  ];

  const title = useMemo(() => {
    if (pathname === "/superadmin") return "Dashboard";
    if (pathname.startsWith("/superadmin/companies/add")) return "Add Company";
    if (pathname.startsWith("/superadmin/companies")) return "Companies";
    if (pathname.startsWith("/superadmin/profile")) return "Profile";
    return "Superadmin";
  }, [pathname]);

  /** Sidebar content (shared) */
  const SidebarInner = ({ compact = false }: { compact?: boolean }) => (
    <div className={`flex h-full ${compact ? "w-16" : "w-56"} transition-all`}>
      <div className="flex flex-col w-full">
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
                  // Dashboard should only be active on exact path
                  if (to === "/superadmin") return pathname === "/superadmin";
                  // Companies: active on list and details, but not on add
                  if (to === "/superadmin/companies") {
                    return (
                      pathname.startsWith("/superadmin/companies") &&
                      !pathname.startsWith("/superadmin/companies/add")
                    );
                  }
                  // Default: exact or nested under the link
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

        <div className="border-t border-border p-3">
          <div className="flex items-center gap-2 mb-2 text-sidebar-active">
            <User size={16} />
            {!compact && <span className="truncate">{u?.name || "User"}</span>}
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
        {/* Desktop sidebar (in-flow, sticky — no overlap) */}
        <aside
          className="hidden md:block bg-sidebar-bg text-sidebar-text border-r border-border shadow-sm
                     sticky top-0 h-screen"
          aria-label="Sidebar"
        >
          <SidebarInner compact={!desktopOpen} />
        </aside>

        {/* Mobile drawer (overlay) */}
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

              <div className="ml-auto flex items-center gap-3">
                <div className="hidden md:block">
                  <input
                    placeholder="Search…"
                    className="h-9 w-56 rounded-md border border-border bg-surface px-3 outline-none focus:ring-2 focus:ring-primary"
                    aria-label="Search"
                  />
                </div>
                <div className="h-9 px-3 rounded-md border border-border bg-surface text-muted flex items-center">
                  {u?.email || "superadmin@example.com"}
                </div>
              </div>
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
