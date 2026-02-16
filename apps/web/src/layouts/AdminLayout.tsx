import type { ComponentType } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { clearAuth, hasPermission } from "../lib/auth";
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { resolveMediaUrl } from "../lib/utils";
import {
  LayoutDashboard,
  Users,
  UserPlus,
  CalendarCheck2,
  ClipboardList,
  LogOut,
  User,
  Settings,
  UserCog,
  FileText,
  Clock,
  Wallet,
  Megaphone,
  UserCircle2Icon,
  BarChart3,
  CalendarRange,
  Receipt,
  X,
  Package,
  Bell,
  Target,
  ClipboardCheck,
} from "lucide-react";
import LayoutSidebar from "../components/LayoutSidebar";
import LayoutNavbar, { ProfileMenuItem } from "../components/LayoutNavbar";
import { useSidebarOpenSections } from "../hooks/useSidebarSections";
import AnnouncementsPopup from "../components/AnnouncementsPopup";
import { useCurrentEmployee } from "../hooks/useCurrentEmployee";

type Item = {
  to: string;
  label: string;
  icon: ComponentType<{ size?: number | string }>;
  permission?: { module: string; action?: string };
};

type Section = {
  key: string;
  label: string;
  items: Item[];
};

export default function AdminLayout() {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const { employee: u } = useCurrentEmployee();

  const [desktopOpen, setDesktopOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => setMobileOpen(false), [pathname]);

  const [companyLogoSquareUrl, setCompanyLogoSquareUrl] = useState<
    string | null
  >(null);
  const [companyLogoWideUrl, setCompanyLogoWideUrl] = useState<string | null>(
    null
  );
  const resolveLogoUrl = (value?: string | null) => resolveMediaUrl(value);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/companies/branding");
        const b = res?.data?.branding || {};
        const square = resolveLogoUrl(b.logoSquare) || resolveLogoUrl(b.logo);
        const wide = resolveLogoUrl(b.logoHorizontal) || resolveLogoUrl(b.logo);
        setCompanyLogoSquareUrl(square);
        setCompanyLogoWideUrl(wide);
      } catch {}
    })();
  }, []);

  const sections = useMemo<Section[]>(
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
          {
            to: "/admin/employees",
            label: "Employee List",
            icon: Users,
            permission: { module: "employees", action: "read" },
          },
          {
            to: "/admin/employees/archive",
            label: "Employee Archive",
            icon: Users,
            permission: { module: "employees", action: "read" },
          },
          {
            to: "/admin/roles",
            label: "Roles",
            icon: UserCog,
            permission: { module: "roles", action: "read" },
          },
          // { to: "/admin/profile", label: "Profile", icon: User },
        ],
      },
      {
        key: "performance",
        label: "Performance",
        items: [
          {
            to: "/admin/kras",
            label: "KRAs",
            icon: Target,
            permission: { module: "employees", action: "read" },
          },
          {
            to: "/admin/kras/questions",
            label: "KRA Question Bank",
            icon: ClipboardList,
            permission: { module: "employees", action: "read" },
          },
          {
            to: "/admin/kras/all",
            label: "All KRAs",
            icon: ClipboardList,
            permission: { module: "employees", action: "read" },
          },
          {
            to: "/admin/appraisals",
            label: "Appraisals",
            icon: ClipboardCheck,
            permission: { module: "employees", action: "read" },
          },
        ],
      },
      {
        key: "onboarding",
        label: "Onboarding",
        items: [
          {
            to: "/admin/onboarding/pipeline",
            label: "Pipeline",
            icon: ClipboardList,
            permission: { module: "employees", action: "write" },
          },
          {
            to: "/admin/onboarding/add",
            label: "Add Candidate",
            icon: UserPlus,
            permission: { module: "employees", action: "write" },
          },
        ],
      },
      {
        key: "assets",
        label: "Assets",
        items: [
          {
            to: "/admin/inventory",
            label: "Inventory",
            icon: Package,
          },
        ],
      },
      {
        key: "projects",
        label: "Projects",
        items: [
          {
            to: "/admin/projects",
            label: "Projects",
            icon: ClipboardList,
            permission: { module: "projects", action: "read" },
          },
          {
            to: "/admin/clients",
            label: "Clients",
            icon: ClipboardList,
            permission: { module: "projects", action: "read" },
          },
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
            permission: { module: "attendance", action: "read" },
          },
          {
            to: "/admin/attendance-requests",
            label: "Attendance Requests",
            icon: Bell,
            permission: { module: "attendance", action: "read" },
          },
        ],
      },
      {
        key: "leaves",
        label: "Leaves",
        items: [
          {
            to: "/admin/leaves",
            label: "Leave Requests",
            icon: ClipboardList,
            permission: { module: "leaves", action: "read" },
          },
          {
            to: "/admin/leave-settings",
            label: "Leave Settings",
            icon: Settings,
            permission: { module: "leave_settings", action: "write" },
          },
          {
            to: "/admin/reports/leave-records",
            label: "Leave Records",
            icon: CalendarRange,
            permission: { module: "reports", action: "read" },
          },
        ],
      },
      {
        key: "reports",
        label: "Reports",
        items: [
          {
            to: "/admin/reports/attendance",
            label: "Attendance Report",
            icon: CalendarCheck2,
            permission: { module: "reports", action: "read" },
          },
          {
            to: "/admin/reports/projects",
            label: "Project Reports",
            icon: BarChart3,
            permission: { module: "reports", action: "read" },
          },
          {
            to: "/admin/reports/leaves",
            label: "Leave Reports",
            icon: CalendarRange,
            permission: { module: "reports", action: "read" },
          },
          {
            to: "/admin/reports/salary-slips",
            label: "Salary Slips",
            icon: Receipt,
            permission: { module: "salary", action: "read" },
          },
          {
            to: "/admin/reports/time-tracking",
            label: "Time Tracking",
            icon: Clock,
            permission: { module: "reports", action: "read" },
          },
        ],
      },
      {
        key: "finance",
        label: "Finance",
        items: [
          {
            to: "/admin/invoices",
            label: "Invoices",
            icon: FileText,
            permission: { module: "finance", action: "read" },
          },
          {
            to: "/admin/expenses",
            label: "Expenses",
            icon: Wallet,
            permission: { module: "finance", action: "write" },
          },
          {
            to: "/admin/reimbursements",
            label: "Reimbursements",
            icon: Wallet,
            permission: { module: "finance", action: "write" },
          },
          {
            to: "/admin/salary/template",
            label: "Salary Template",
            icon: FileText,
            permission: { module: "salary", action: "write" },
          },
          {
            to: "/admin/salary/slips",
            label: "Salary Slips",
            icon: ClipboardList,
            permission: { module: "salary", action: "read" },
          },
        ],
      },
      {
        key: "company",
        label: "Company",
        items: [
          {
            to: "/admin/company",
            label: "Company",
            icon: Settings,
            permission: { module: "company", action: "write" },
          },
          {
            to: "/admin/company-timing",
            label: "Company Timing",
            icon: Clock,
            permission: { module: "company", action: "write" },
          },
          {
            to: "/admin/announcements",
            label: "Announcements",
            icon: Megaphone,
            permission: { module: "announcements", action: "write" },
          },
        ],
      },
    ],
    []
  );

  const permittedSections = useMemo(() => {
    return sections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) =>
          item.permission
            ? hasPermission(u, item.permission.module, item.permission.action)
            : true
        ),
      }))
      .filter((section) => section.items.length > 0);
  }, [sections, u]);

  const sectionsToRender = permittedSections.length
    ? permittedSections
    : sections;
  const navPaths = useMemo(
    () => sectionsToRender.flatMap((s) => s.items.map((it) => it.to)),
    [sectionsToRender]
  );

  const title = useMemo(() => {
    for (const s of sectionsToRender) {
      for (const it of s.items) {
        if (it.to === "/admin" && pathname === "/admin") return it.label;
        if (it.to === "/admin/employees/add" && pathname.startsWith(it.to))
          return it.label;
        if (it.to === "/admin/employees") {
          const isEmployeesList =
            pathname.startsWith("/admin/employees") &&
            !pathname.startsWith("/admin/employees/add") &&
            !pathname.startsWith("/admin/employees/archive");
          if (isEmployeesList) return it.label;
        }
        if (pathname === it.to || pathname.startsWith(it.to + "/"))
          return it.label;
      }
    }
    return "Admin";
  }, [pathname, sectionsToRender]);

  const STORAGE_KEY = "adminSidebarOpenSections";
  const autoOpenKey = useMemo(() => {
    for (const s of sectionsToRender) {
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
    return sectionsToRender[0]?.key ?? "overview";
  }, [pathname, sectionsToRender]);

  const { openSections, toggleSection } = useSidebarOpenSections(
    STORAGE_KEY,
    autoOpenKey
  );

  const itemIsActive = (to: string) => {
    if (to === "/admin") return pathname === "/admin";
    if (to === "/admin/employees")
      return (
        pathname.startsWith("/admin/employees") &&
        !pathname.startsWith("/admin/employees/add") &&
        !pathname.startsWith("/admin/employees/archive")
      );
    const matches = navPaths.filter(
      (p) => pathname === p || pathname.startsWith(p + "/")
    );
    if (matches.length === 0) return false;
    const longest = matches.sort((a, b) => b.length - a.length)[0];
    return to === longest;
  };

  const initials = (u?.name || "Admin")
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();

  const headerClassName =
    "bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80 border-b border-border shadow-sm";

  const desktopSidebarWidthClass = desktopOpen ? "w-56" : "w-14";
  const desktopContentOffsetClass = desktopOpen ? "md:pl-56" : "md:pl-14";
  const desktopHeaderOffsetClasses = desktopOpen
    ? "md:w-[calc(100%-14rem)]"
    : "md:w-[calc(100%-3.5rem)]";

  const profileMenuItems = useMemo<ProfileMenuItem[]>(
    () => [
      {
        label: "Profile",
        icon: <UserCircle2Icon size={16} />,
        onClick: () => nav("/admin/profile"),
      },
      {
        label: "Logout",
        icon: <LogOut size={16} />,
        onClick: () => {
          clearAuth();
          nav("/login");
        },
      },
    ],
    [nav, clearAuth]
  );

  return (
    <div className="min-h-screen bg-bg text-text overflow-x-hidden">
      <div
        className={`fixed inset-0 bg-black/40 z-40 md:hidden transition-opacity ${
          mobileOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setMobileOpen(false)}
      />

      <div
        className={`flex w-full ${desktopContentOffsetClass} transition-all`}
      >
        <aside
          className={`hidden md:block fixed inset-y-0 left-0 bg-sidebar-bg text-sidebar-text border-r border-border shadow-sm transition-[width] duration-200 ${desktopSidebarWidthClass}`}
          aria-label="Sidebar"
        >
          <LayoutSidebar
            sections={sectionsToRender}
            pathname={pathname}
            compact={!desktopOpen}
            logoSquareUrl={companyLogoSquareUrl}
            logoWideUrl={companyLogoWideUrl}
            openSections={openSections}
            toggleSection={toggleSection}
            itemIsActive={itemIsActive}
          />
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
            <LayoutSidebar
              sections={sectionsToRender}
              pathname={pathname}
              compact={false}
              logoSquareUrl={companyLogoSquareUrl}
              logoWideUrl={companyLogoWideUrl}
              openSections={openSections}
              toggleSection={toggleSection}
              itemIsActive={itemIsActive}
            />
          </div>
        </aside>

        <div className="flex-1 min-w-0 flex flex-col min-h-screen">
          <LayoutNavbar
            title={title}
            desktopOpen={desktopOpen}
            onDesktopToggle={() => setDesktopOpen((v) => !v)}
            mobileOpen={mobileOpen}
            onMobileToggle={() => setMobileOpen(true)}
            initials={initials}
            headerOffsetClass={desktopHeaderOffsetClasses}
            headerClassName={headerClassName}
            profileMenuItems={profileMenuItems}
          />

          <main
            id="main"
            className="flex-1 p-4 pt-24 md:p-8 md:pt-24 bg-bg min-w-0 overflow-x-auto"
          >
            <AnnouncementsPopup />
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
