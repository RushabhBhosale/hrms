import {
  Outlet,
  NavLink,
  useLocation,
  useNavigate,
  useMatch,
} from "react-router-dom";
import { clearAuth, getEmployee } from "../lib/auth";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  LayoutDashboard,
  Building2,
  LogOut,
  Menu,
  X,
  User,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";

export default function SuperAdminLayout() {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const u = getEmployee();

  const [desktopOpen, setDesktopOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [companiesOpen, setCompaniesOpen] = useState(
    pathname.startsWith("/superadmin/companies")
  );

  const companiesMatch = useMatch("/superadmin/companies/*");
  const dashboardMatch = useMatch({ path: "/superadmin", end: true });
  const profileMatch = useMatch("/superadmin/profile/*");

  useEffect(() => setMobileOpen(false), [pathname]);
  useEffect(() => {
    setCompaniesOpen(pathname.startsWith("/superadmin/companies"));
  }, [pathname]);

  const title = useMemo(() => {
    if (dashboardMatch) return "Dashboard";
    if (pathname.startsWith("/superadmin/companies/add")) return "Add Company";
    if (companiesMatch) return "Companies";
    if (profileMatch) return "Profile";
    return "Superadmin";
  }, [pathname, companiesMatch, dashboardMatch, profileMatch]);

  const initials = (u?.name || "User")
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();

  const SidebarInner = ({ compact = false }: { compact?: boolean }) => (
    <div className={`flex h-full ${compact ? "w-16" : "w-56"} transition-all`}>
      <div className="flex flex-col w-full">
        <div
          className={`${
            compact ? "justify-center" : "justify-between"
          } flex items-center h-[66px] border-b border-border`}
        >
          <div className="font-bold text-sidebar-active tracking-wide">
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
          <NavLink
            to="/superadmin"
            end
            className={({ isActive }) =>
              [
                "flex items-center gap-3 rounded-md px-3 py-2 transition",
                isActive
                  ? "bg-primary/10 text-sidebar-active font-semibold"
                  : "hover:bg-sidebar-hover",
              ].join(" ")
            }
            title="Dashboard"
          >
            <LayoutDashboard size={18} />
            {!compact && <span className="truncate">Dashboard</span>}
          </NavLink>

          <div>
            <button
              onClick={() => setCompaniesOpen((v) => !v)}
              className={[
                "w-full flex items-center gap-3 rounded-md px-3 py-2 transition",
                "hover:bg-sidebar-hover",
              ].join(" ")}
              aria-expanded={companiesOpen}
              aria-controls="companies-submenu"
              type="button"
            >
              <Building2 size={18} />
              {!compact && <span className="truncate">Companies</span>}
              {!compact && (
                <span className="ml-auto">
                  {companiesOpen ? (
                    <ChevronDown size={16} />
                  ) : (
                    <ChevronRight size={16} />
                  )}
                </span>
              )}
            </button>

            <div
              id="companies-submenu"
              className={`ml-8 mt-1 space-y-1 ${
                companiesOpen ? "block" : "hidden"
              }`}
            >
              <NavLink
                to="/superadmin/companies"
                end
                className={({ isActive }) =>
                  [
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition",
                    isActive
                      ? "bg-primary/10 text-sidebar-active font-semibold"
                      : "hover:bg-sidebar-hover",
                  ].join(" ")
                }
                title="All Companies"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-current opacity-60" />
                {!compact && <span className="truncate">All Companies</span>}
              </NavLink>

              <NavLink
                to="/superadmin/companies/add"
                end
                className={({ isActive }) =>
                  [
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition",
                    isActive
                      ? "bg-primary/10 text-sidebar-active font-semibold"
                      : "hover:bg-sidebar-hover",
                  ].join(" ")
                }
                title="Add Company"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-current opacity-60" />
                {!compact && <span className="truncate">Add Company</span>}
              </NavLink>
            </div>
          </div>

          <NavLink
            to="/superadmin/profile"
            className={({ isActive }) =>
              [
                "flex items-center gap-3 rounded-md px-3 py-2 transition",
                isActive
                  ? "bg-primary/10 text-sidebar-active font-semibold"
                  : "hover:bg-sidebar-hover",
              ].join(" ")
            }
            title="Profile"
          >
            <User size={18} />
            {!compact && <span className="truncate">Profile</span>}
          </NavLink>
        </nav>
      </div>
    </div>
  );

  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node))
        setProfileMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setProfileMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className="min-h-screen bg-bg text-text">
      <div
        className={`fixed inset-0 bg-black/40 z-40 md:hidden transition-opacity ${
          mobileOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setMobileOpen(false)}
      />
      <div className="flex">
        <aside
          className="hidden md:block bg-sidebar-bg text-sidebar-text border-r border-border shadow-sm sticky top-0 h-screen"
          aria-label="Sidebar"
        >
          <SidebarInner compact={!desktopOpen} />
        </aside>

        <aside
          className={`md:hidden fixed top-0 left-0 z-50 h-full bg-sidebar-bg text-sidebar-text border-r border-border shadow-sm transform transition-transform ${
            mobileOpen ? "translate-x-0" : "-translate-x-full"
          }`}
          aria-label="Mobile Sidebar"
        >
          <div className="flex items-center justify-between px-4 h-14 border-b border-border">
            <div className="font-bold text-sidebar-active tracking-wide">
              <img src="/peracto_logo.png" />
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

        <div className="flex-1 grid grid-rows-[auto_1fr] min-h-screen">
          <header className="sticky top-0 z-30 bg-surface border-b border-border shadow-sm">
            <div className="h-16 px-3 md:px-6 flex items-center gap-3">
              <button
                onClick={() => setMobileOpen(true)}
                className="md:hidden inline-flex items-center justify-center h-9 w-9 rounded-md border border-border bg-surface"
                aria-label="Open sidebar"
                aria-expanded={mobileOpen}
              >
                <Menu size={18} />
              </button>
              <button
                onClick={() => setDesktopOpen((v) => !v)}
                className="hidden md:inline-flex items-center justify-center h-9 w-9 rounded-md border border-border bg-surface hover:bg-bg"
                aria-label={desktopOpen ? "Collapse sidebar" : "Expand sidebar"}
                title={desktopOpen ? "Collapse sidebar" : "Expand sidebar"}
              >
                {desktopOpen ? (
                  <PanelLeftClose size={18} />
                ) : (
                  <PanelLeftOpen size={18} />
                )}
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

                <div className="relative" ref={profileRef}>
                  <button
                    onClick={() => setProfileMenuOpen((o) => !o)}
                    className="flex items-center gap-2 rounded-full border border-border bg-surface pl-2 pr-2.5 h-9"
                    aria-haspopup="menu"
                    aria-expanded={profileMenuOpen}
                    title={u?.name || "Account"}
                  >
                    <div className="grid place-items-center h-7 w-7 rounded-full bg-primary/15 text-primary text-xs font-semibold">
                      {initials}
                    </div>
                    <ChevronDown size={16} className="text-muted" />
                  </button>

                  {profileMenuOpen && (
                    <div
                      className="absolute right-0 mt-2 w-44 rounded-md border border-border bg-surface shadow-lg z-50 py-1"
                      role="menu"
                    >
                      <button
                        onClick={() => {
                          setProfileMenuOpen(false);
                          nav("/superadmin/profile");
                        }}
                        className="w-full px-4 py-2 text-left hover:bg-sidebar-hover text-sm"
                        role="menuitem"
                      >
                        Profile
                      </button>
                      <button
                        onClick={() => {
                          clearAuth();
                          nav("/login");
                        }}
                        className="w-full px-4 py-2 text-left hover:bg-sidebar-hover text-sm text-accent inline-flex items-center gap-2"
                        role="menuitem"
                      >
                        <LogOut size={16} />
                        Logout
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </header>

          <main id="main" className="p-4 md:p-8 bg-bg">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
