import type { ComponentType } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { clearAuth, hasPermission } from "../lib/auth";
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { resolveMediaUrl } from "../lib/utils";
import {
  Home,
  Clock8,
  CalendarCheck2,
  CalendarRange,
  LogOut,
  User,
  FileText,
  ClipboardList,
  Users,
  ListChecks,
  Wallet,
  Megaphone,
  UserCircle2Icon,
  X,
  Target,
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
};

type Section = {
  key: string;
  label: string;
  items: Item[];
};

export default function EmployeeLayout() {
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

  const canViewTeamAttendance = hasPermission(u, "attendance", "read");
  const canManageAttendance = hasPermission(u, "attendance", "write");
  const canViewReports = hasPermission(u, "reports", "read");
  const canManageLeaves = hasPermission(u, "leaves", "write");
  const canViewLeaveQueue =
    hasPermission(u, "leaves", "read") || canManageLeaves;
  const canViewFinance =
    hasPermission(u, "finance", "read") || hasPermission(u, "finance", "write");
  const canManageFinance = hasPermission(u, "finance", "write");
  const canManageSalaries = hasPermission(u, "salary", "write");
  const isManager =
    (u?.subRoles || []).includes("manager") ||
    (u?.subRoles || []).includes("hr");

  const sections = useMemo<Section[]>(() => {
    const itemsAttendance: Item[] = [
      { to: "/app/attendance", label: "My Attendance", icon: Clock8 },
    ];
    if (canViewTeamAttendance) {
      itemsAttendance.push({
        to: "/app/attendances",
        label: "Team Attendance",
        icon: Users,
      });
    }
    if (canViewReports || canManageAttendance) {
      itemsAttendance.push({
        to: "/app/report",
        label: "Reports",
        icon: FileText,
      });
    }

    const itemsFinance: Item[] = [];
    if (canManageFinance) {
      itemsFinance.push({
        to: "/app/expenses",
        label: "Expenses",
        icon: Wallet,
      });
    }
    if (canViewFinance) {
      itemsFinance.push({
        to: "/app/invoices",
        label: "Invoices",
        icon: FileText,
      });
    }
    if (canManageSalaries) {
      itemsFinance.push({
        to: "/app/salaries",
        label: "Salaries",
        icon: Users,
      });
    }

    const sections: Section[] = [
      {
        key: "overview",
        label: "Overview",
        items: [{ to: "/app", label: "Dashboard", icon: Home }],
      },
      {
        key: "work",
        label: "Work",
        items: [
          { to: "/app/tasks", label: "Tasks", icon: ListChecks },
          { to: "/app/projects", label: "Projects", icon: Users },
        ],
      },
      {
        key: "attendance",
        label: "Attendance",
        items: itemsAttendance,
      },
      {
        key: "leave",
        label: "Leave",
        items: [
          { to: "/app/leave", label: "My Requests", icon: CalendarCheck2 },
          ...(canManageLeaves
            ? [
                {
                  to: "/app/approvals",
                  label: "Approvals",
                  icon: ClipboardList,
                },
              ]
            : canViewLeaveQueue
            ? [
                {
                  to: "/app/approvals",
                  label: "Team Requests",
                  icon: ClipboardList,
                },
              ]
            : []),
        ],
      },
      ...(itemsFinance.length
        ? [
            {
              key: "finance",
              label: "Finance",
              items: itemsFinance,
            } as Section,
          ]
        : []),
      {
        key: "performance",
        label: "Performance",
        items: [
          { to: "/app/kras", label: "My KRAs", icon: Target },
          ...(isManager
            ? [{ to: "/app/kras/team", label: "Team KRAs", icon: Users }]
            : []),
        ],
      },
      {
        key: "paydocs",
        label: "Pay & Docs",
        items: [
          { to: "/app/salary-slip", label: "Salary Slip", icon: FileText },
          { to: "/app/documents", label: "Documents", icon: FileText },
          { to: "/app/reimbursements", label: "Reimbursements", icon: Wallet },
        ],
      },
      {
        key: "company",
        label: "Company",
        items: [
          {
            to: "/app/announcements",
            label: "Announcements",
            icon: Megaphone,
          },
          { to: "/app/holidays", label: "Holidays", icon: CalendarRange },
          { to: "/app/profile", label: "Profile", icon: User },
        ],
      },
    ];

    return sections;
  }, [
    canManageAttendance,
    canViewTeamAttendance,
    canViewReports,
    canManageLeaves,
    canViewLeaveQueue,
    canViewFinance,
    canManageFinance,
    canManageSalaries,
    isManager,
  ]);

  const title = useMemo(() => {
    for (const s of sections) {
      for (const it of s.items) {
        if (it.to === "/app" && pathname === "/app") return it.label;
        if (pathname === it.to || pathname.startsWith(it.to + "/"))
          return it.label;
      }
    }
    return "Employee";
  }, [pathname, sections]);

  const STORAGE_KEY = "employeeSidebarOpenSections";
  const autoOpenKey = useMemo(() => {
    for (const s of sections) {
      if (
        s.items.some((it) => {
          if (it.to === "/app") return pathname === "/app";
          return pathname === it.to || pathname.startsWith(it.to + "/");
        })
      )
        return s.key;
    }
    return sections[0]?.key ?? "overview";
  }, [pathname, sections]);

  const { openSections, toggleSection } = useSidebarOpenSections(
    STORAGE_KEY,
    autoOpenKey
  );

  const itemIsActive = (to: string) => {
    if (to === "/app") return pathname === "/app";
    return pathname === to || pathname.startsWith(to + "/");
  };

  const desktopSidebarWidthClass = desktopOpen ? "w-56" : "w-14";
  const desktopContentOffsetClass = desktopOpen ? "md:pl-56" : "md:pl-14";
  const desktopHeaderOffsetClasses = desktopOpen
    ? "md:w-[calc(100%-14rem)]"
    : "md:w-[calc(100%-3.5rem)]";

  const initials = (u?.name || "Employee")
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();

  const headerClassName =
    "bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80 border-b border-border shadow-sm";

  const profileMenuItems = useMemo<ProfileMenuItem[]>(
    () => [
      {
        label: "Profile",
        icon: <UserCircle2Icon size={16} />,
        onClick: () => nav("/app/profile"),
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
            sections={sections}
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
            <LayoutSidebar
              sections={sections}
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
