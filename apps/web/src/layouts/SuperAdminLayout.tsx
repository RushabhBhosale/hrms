import type { ComponentType } from "react";
import { Outlet, useLocation, useNavigate, useMatch } from "react-router-dom";
import { clearAuth } from "../lib/auth";
import { useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard,
  Building2,
  LogOut,
  User,
  X,
  UserCircle2Icon,
} from "lucide-react";
import LayoutSidebar from "../components/LayoutSidebar";
import LayoutNavbar, { ProfileMenuItem } from "../components/LayoutNavbar";
import { useSidebarOpenSections } from "../hooks/useSidebarSections";
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

export default function SuperAdminLayout() {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const { employee: u } = useCurrentEmployee();

  const dashboardMatch = useMatch({ path: "/superadmin", end: true });
  const companiesMatch = useMatch("/superadmin/companies/*");
  const profileMatch = useMatch("/superadmin/profile/*");

  const [desktopOpen, setDesktopOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => setMobileOpen(false), [pathname]);

  const sections = useMemo<Section[]>(
    () => [
      {
        key: "overview",
        label: "Overview",
        items: [
          { to: "/superadmin", label: "Dashboard", icon: LayoutDashboard },
        ],
      },
      {
        key: "companies",
        label: "Companies",
        items: [
          {
            to: "/superadmin/companies",
            label: "All Companies",
            icon: Building2,
          },
          {
            to: "/superadmin/companies/add",
            label: "Add Company",
            icon: Building2,
          },
        ],
      },
      {
        key: "profile",
        label: "Profile",
        items: [{ to: "/superadmin/profile", label: "Profile", icon: User }],
      },
    ],
    []
  );

  const title = useMemo(() => {
    if (dashboardMatch) return "Dashboard";
    if (pathname.startsWith("/superadmin/companies/add")) return "Add Company";
    if (companiesMatch) return "Companies";
    if (profileMatch) return "Profile";
    return "Superadmin";
  }, [pathname, companiesMatch, dashboardMatch, profileMatch]);

  const STORAGE_KEY = "superadminSidebarOpenSections";
  const autoOpenKey = useMemo(() => {
    if (pathname.startsWith("/superadmin/companies")) return "companies";
    if (pathname.startsWith("/superadmin/profile")) return "profile";
    if (pathname === "/superadmin") return "overview";
    return sections[0]?.key ?? "overview";
  }, [pathname, sections]);

  const { openSections, toggleSection } = useSidebarOpenSections(
    STORAGE_KEY,
    autoOpenKey
  );

  const itemIsActive = (to: string) => {
    if (to === "/superadmin") return pathname === "/superadmin";
    return pathname === to || pathname.startsWith(to + "/");
  };

  const desktopSidebarWidthClass = desktopOpen ? "w-56" : "w-14";
  const desktopContentOffsetClass = desktopOpen ? "md:pl-56" : "md:pl-14";
  const desktopHeaderOffsetClasses = desktopOpen
    ? "md:w-[calc(100%-14rem)]"
    : "md:w-[calc(100%-3.5rem)]";

  const initials = (u?.name || "User")
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();

  const headerClassName = "bg-surface border-b border-border shadow-sm";

  const profileMenuItems = useMemo<ProfileMenuItem[]>(
    () => [
      {
        label: "Profile",
        icon: <UserCircle2Icon size={16} />,
        onClick: () => nav("/superadmin/profile"),
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
            logoSquareUrl="/logo.png"
            logoWideUrl="/logo-horizontal.png"
            widthClass={{ compact: "w-14", expanded: "w-56" }}
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
              <img src="/peracto_logo.png" alt="Peracto" />
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
              logoSquareUrl="/logo.png"
              logoWideUrl="/logo-horizontal.png"
              widthClass={{ compact: "w-14", expanded: "w-56" }}
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
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
