import type { ReactNode } from "react";
import { Menu, PanelLeftClose, PanelLeftOpen, ChevronDown } from "lucide-react";
import NotificationBell from "./NotificationBell";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

export type ProfileMenuItem = {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
};

type LayoutNavbarProps = {
  title: string;
  desktopOpen: boolean;
  onDesktopToggle: () => void;
  mobileOpen: boolean;
  onMobileToggle: () => void;
  headerOffsetClass: string;
  headerClassName?: string;
  initials: string;
  profileMenuItems: ProfileMenuItem[];
  searchPlaceholder?: string;
};

export default function LayoutNavbar({
  title,
  desktopOpen,
  onDesktopToggle,
  mobileOpen,
  onMobileToggle,
  headerOffsetClass,
  headerClassName,
  initials,
  profileMenuItems,
  searchPlaceholder = "Search…",
}: LayoutNavbarProps) {
  const headerClasses = [
    "fixed top-0 z-30 w-full transition-all",
    headerClassName ??
      "bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80 border-b border-border shadow-sm",
    headerOffsetClass,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <header className={headerClasses}>
      <div className="h-16 px-3 md:px-6 flex items-center gap-3">
        <Button
          onClick={onMobileToggle}
          variant="outline"
          size="icon"
          className="md:hidden"
          aria-label="Open sidebar"
          aria-expanded={mobileOpen}
        >
          <Menu size={18} />
        </Button>

        <Button
          onClick={onDesktopToggle}
          variant="outline"
          size="icon"
          className="hidden md:inline-flex"
          aria-label={desktopOpen ? "Collapse sidebar" : "Expand sidebar"}
          title={desktopOpen ? "Collapse sidebar" : "Expand sidebar"}
        >
          {desktopOpen ? (
            <PanelLeftClose size={18} />
          ) : (
            <PanelLeftOpen size={18} />
          )}
        </Button>

        <h1 className="text-lg md:text-xl font-semibold">{title}</h1>

        <div className="ml-auto flex items-center gap-3">
          <div className="hidden md:block">
            <input
              placeholder={searchPlaceholder}
              className="h-9 w-56 rounded-md border border-border bg-surface px-3 outline-none focus:ring-2 focus:ring-primary"
              aria-label={searchPlaceholder}
            />
          </div>

          <NotificationBell />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="pl-2 pr-2.5 h-9 rounded-full"
                aria-haspopup="menu"
                aria-label="Account menu"
              >
                <div className="grid place-items-center h-7 w-7 rounded-full bg-primary/15 text-primary text-xs font-semibold">
                  {initials}
                </div>
                <ChevronDown size={16} className="text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel>Account</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {profileMenuItems.map(({ label, icon, onClick }) => (
                <DropdownMenuItem
                  key={label}
                  onSelect={(e) => {
                    e.preventDefault();
                    onClick();
                  }}
                  className="flex items-center gap-2"
                >
                  {icon}
                  <span>{label}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
