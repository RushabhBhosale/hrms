import { Outlet, NavLink, useLocation, useNavigate } from "react-router-dom";
import { clearAuth, getEmployee } from "../lib/auth";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
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
  Wallet,
  Megaphone,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  UserCircle2Icon,
} from "lucide-react";
import AnnouncementsPopup from "../components/AnnouncementsPopup";

export default function AdminLayout() {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const u = getEmployee();

  const [desktopOpen, setDesktopOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => setMobileOpen(false), [pathname]);

  const [companyLogoSquareUrl, setCompanyLogoSquareUrl] = useState<
    string | null
  >(null);
  const [companyLogoWideUrl, setCompanyLogoWideUrl] = useState<string | null>(
    null
  );

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/companies/branding");
        const base = import.meta.env.VITE_API_URL || "http://localhost:4000";
        const b = res?.data?.branding || {};
        const square = b.logoSquare
          ? `${base}/uploads/${b.logoSquare}`
          : b.logo
          ? `${base}/uploads/${b.logo}`
          : null;
        const wide = b.logoHorizontal
          ? `${base}/uploads/${b.logoHorizontal}`
          : b.logo
          ? `${base}/uploads/${b.logo}`
          : null;
        setCompanyLogoSquareUrl(square);
        setCompanyLogoWideUrl(wide);
      } catch {}
    })();
  }, []);

  type Item = {
    to: string;
    label: string;
    icon: React.ComponentType<{ size?: number }>;
  };
  type Section = { key: string; label: string; items: Item[] };

  const sections = useMemo(
    () => [
      {
        key: "overview",
        label: "Overview",
        items: [{ to: "/admin", label: "Dashboard", icon: LayoutDashboard }],
      },
      {
        key: "people",
        label: "People",
        items: [
          // { to: "/admin/employees/add", label: "Add Employee", icon: UserPlus },
          { to: "/admin/employees", label: "Employee List", icon: Users },
          { to: "/admin/roles", label: "Roles", icon: UserCog },
          { to: "/admin/profile", label: "Profile", icon: User },
        ],
      },
      {
        key: "projects",
        label: "Projects",
        items: [
          { to: "/admin/projects", label: "Projects", icon: ClipboardList },
        ],
      },
      {
        key: "attendance",
        label: "Attendance & Leave",
        items: [
          {
            to: "/admin/attendances",
            label: "Attendances",
            icon: CalendarCheck2,
          },
          { to: "/admin/leaves", label: "Leave Requests", icon: ClipboardList },
          {
            to: "/admin/leave-settings",
            label: "Leave Settings",
            icon: Settings,
          },
          { to: "/admin/report", label: "Report", icon: FileText },
        ],
      },
      {
        key: "finance",
        label: "Finance",
        items: [
          { to: "/admin/invoices", label: "Invoices", icon: FileText },
          { to: "/admin/expenses", label: "Expenses", icon: Wallet },
          {
            to: "/admin/salary/template",
            label: "Salary Template",
            icon: FileText,
          },
          {
            to: "/admin/salary/slips",
            label: "Salary Slips",
            icon: ClipboardList,
          },
        ],
      },
      {
        key: "company",
        label: "Company",
        items: [
          { to: "/admin/company", label: "Company", icon: Settings },
          { to: "/admin/company-timing", label: "Company Timing", icon: Clock },
          {
            to: "/admin/announcements",
            label: "Announcements",
            icon: Megaphone,
          },
        ],
      },
    ],
    []
  );

  const title = useMemo(() => {
    for (const s of sections) {
      for (const it of s.items) {
        if (it.to === "/admin" && pathname === "/admin") return it.label;
        if (it.to === "/admin/employees/add" && pathname.startsWith(it.to))
          return it.label;
        if (it.to === "/admin/employees") {
          const isEmployeesList =
            pathname.startsWith("/admin/employees") &&
            !pathname.startsWith("/admin/employees/add");
          if (isEmployeesList) return it.label;
        }
        if (pathname === it.to || pathname.startsWith(it.to + "/"))
          return it.label;
      }
    }
    return "Admin";
  }, [pathname, sections]);

  const STORAGE_KEY = "adminSidebarOpenSections";
  const autoOpenKey = useMemo(() => {
    for (const s of sections) {
      if (
        s.items.some((it) => {
          if (it.to === "/admin") return pathname === "/admin";
          if (it.to === "/admin/employees")
            return (
              pathname.startsWith("/admin/employees") &&
              !pathname.startsWith("/admin/employees/add")
            );
          return pathname === it.to || pathname.startsWith(it.to + "/");
        })
      )
        return s.key;
    }
    return sections[0].key;
  }, [pathname, sections]);

  const [openSections, setOpenSections] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return new Set(JSON.parse(raw));
    } catch {}
    return new Set([autoOpenKey]);
  });

  useEffect(() => {
    setOpenSections((prev) => {
      if (prev.has(autoOpenKey)) return prev;
      const next = new Set(prev);
      next.add(autoOpenKey);
      return next;
    });
  }, [autoOpenKey]);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(Array.from(openSections))
      );
    } catch {}
  }, [openSections]);

  const toggleSection = (key: string) =>
    setOpenSections((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const initials = (u?.name || "Admin")
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();

  const SidebarInner = ({ compact = false }: { compact?: boolean }) => {
    const itemIsActive = (to: string) => {
      if (to === "/admin") return pathname === "/admin";
      if (to === "/admin/employees")
        return (
          pathname.startsWith("/admin/employees") &&
          !pathname.startsWith("/admin/employees/add")
        );
      return pathname === to || pathname.startsWith(to + "/");
    };

    return (
      <div
        className={`flex h-full ${compact ? "w-16" : "w-64"} transition-all`}
      >
        <div className="flex flex-col w-full">
          <div className="flex items-center justify-center h-[66px] border-b border-border">
            <div className="font-bold text-sidebar-active tracking-wide">
              {compact ? (
                <img
                  src={companyLogoSquareUrl || "/logo.png"}
                  alt="logo"
                  className="max-w-none size-10 object-contain"
                />
              ) : (
                <img
                  src={companyLogoWideUrl || "/logo-horizontal.png"}
                  alt="logo"
                  className="h-6 object-contain"
                />
              )}
            </div>
          </div>

          <nav
            className="flex-1 overflow-y-auto px-2 py-3 space-y-2 scrollbar-thin scrollbar-thumb-border/60 scrollbar-track-transparent"
            role="navigation"
            aria-label="Primary"
          >
            {sections.map((section) => {
              const isOpen = compact ? false : openSections.has(section.key);
              const maxH = isOpen ? section.items.length * 44 + 8 : 0;

              return (
                <div key={section.key} className="rounded-md">
                  <button
                    type="button"
                    onClick={() => !compact && toggleSection(section.key)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition"
                    aria-expanded={isOpen}
                    aria-controls={`sect-${section.key}`}
                    title={section.label}
                  >
                    <span className="inline-flex items-center justify-center h-5 w-5 text-muted">
                      {isOpen ? (
                        <ChevronDown size={16} />
                      ) : (
                        <ChevronRight size={16} />
                      )}
                    </span>
                    {!compact && (
                      <span className="text-[11px] uppercase tracking-wide">
                        {section.label}
                      </span>
                    )}
                    {compact && (
                      <span className="sr-only">{section.label}</span>
                    )}
                  </button>

                  <div
                    id={`sect-${section.key}`}
                    className="overflow-hidden transition-[max-height] duration-300 ease-in-out"
                    style={{ maxHeight: compact ? 0 : maxH }}
                    role="group"
                    aria-label={section.label}
                  >
                    <div className="mt-1 space-y-1">
                      {section.items.map(({ to, label, icon: Icon }) => {
                        const active = itemIsActive(to);
                        return (
                          <NavLink
                            key={to}
                            to={to}
                            className={[
                              "relative group flex items-center gap-3 rounded-md px-3 py-2 transition",
                              active
                                ? "bg-primary/10 text-sidebar-active font-semibold"
                                : "hover:bg-sidebar-hover",
                            ].join(" ")}
                            title={label}
                          >
                            {active && (
                              <span
                                className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-0.5 rounded bg-primary"
                                aria-hidden
                              />
                            )}
                            <Icon size={18} />
                            {!compact && (
                              <span className="truncate">{label}</span>
                            )}
                            {compact && (
                              <span className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap rounded-md border border-border bg-surface px-2 py-1 text-xs shadow-lg">
                                {label}
                              </span>
                            )}
                          </NavLink>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </nav>
        </div>
      </div>
    );
  };

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

        <div className="flex-1 grid grid-rows-[auto_1fr] min-h-screen">
          <header className="sticky top-0 z-30 bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80 border-b border-border shadow-sm">
            <div className="h-16 px-3 md:px-6 flex items-center gap-3">
              <button
                onClick={() => setMobileOpen(true)}
                className="md:hidden inline-flex items-center justify-center h-9 w-9 rounded-md border border-border bg-surface hover:bg-bg"
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
                          nav("/admin/profile");
                        }}
                        className="w-full px-4 py-2 text-left hover:bg-sidebar-hover text-sm  inline-flex items-center gap-2"
                        role="menuitem"
                      >
                        <UserCircle2Icon size={16} />
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
            <AnnouncementsPopup />
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
