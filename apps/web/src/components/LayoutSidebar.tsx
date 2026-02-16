import type { ComponentType } from "react";
import { NavLink } from "react-router-dom";
import { ChevronDown, ChevronRight } from "lucide-react";

export type LayoutSidebarItem = {
  to: string;
  label: string;
  icon: ComponentType<{ size?: number | string }>;
};

export type LayoutSidebarSection = {
  key: string;
  label: string;
  items: LayoutSidebarItem[];
};

type WidthClass = {
  compact: string;
  expanded: string;
};

type LayoutSidebarProps = {
  sections: LayoutSidebarSection[];
  pathname: string;
  compact?: boolean;
  logoSquareUrl?: string | null;
  logoWideUrl?: string | null;
  openSections: Set<string>;
  toggleSection: (key: string) => void;
  itemIsActive: (to: string) => boolean;
  widthClass?: WidthClass;
};

const DEFAULT_WIDTH_CLASS: WidthClass = {
  compact: "w-14",
  expanded: "w-52",
};

export default function LayoutSidebar({
  sections,
  compact = false,
  logoSquareUrl,
  logoWideUrl,
  openSections,
  toggleSection,
  pathname,
  itemIsActive,
  widthClass = DEFAULT_WIDTH_CLASS,
}: LayoutSidebarProps) {
  const isOpen = (key: string) => (compact ? false : openSections.has(key));

  return (
    <aside
      className={`flex h-full ${
        compact ? widthClass.compact : widthClass.expanded
      } transition-[width] duration-200`}
      aria-label="Sidebar"
    >
      <div className="flex w-full flex-col bg-background/60 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="sticky top-0 z-10 flex h-[66px] items-center justify-center border-b border-border/60 bg-background/80 backdrop-blur">
          {compact ? (
            <img
              src={logoSquareUrl || "/logo.png"}
              alt="logo"
              className="size-10 object-contain"
            />
          ) : (
            <img
              src={logoWideUrl || "/logo-horizontal.png"}
              alt="logo"
              className="h-6 object-contain"
            />
          )}
        </div>

        <nav
          className="flex-1 space-y-2 overflow-y-auto px-2 py-3 scrollbar-thin scrollbar-thumb-border/60 scrollbar-track-transparent"
          role="navigation"
          aria-label="Primary"
        >
          {sections.map((section) => {
            if (!section.items.length) return null;
            const open = isOpen(section.key);
            const maxH = open ? section.items.length * 44 + 12 : 0;

            return (
              <section key={section.key} className="rounded-md">
                <button
                  type="button"
                  onClick={() => !compact && toggleSection(section.key)}
                  className={[
                    "group flex w-full items-center gap-2 rounded-md px-2 py-2 transition",
                    compact ? "justify-center" : "hover:bg-sidebar-hover",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                  ].join(" ")}
                  aria-expanded={open}
                  aria-controls={`sect-${section.key}`}
                  title={section.label}
                >
                  <span
                    className={[
                      "inline-flex h-5 w-5 items-center justify-center text-muted-foreground transition-transform",
                      open ? "rotate-180" : "rotate-0",
                    ].join(" ")}
                  >
                    <ChevronDown size={16} />
                  </span>

                  {!compact && (
                    <span className="text-sm font-semibold tracking-wide text-foreground">
                      {section.label}
                    </span>
                  )}

                  {compact && <span className="sr-only">{section.label}</span>}
                </button>

                <div
                  id={`sect-${section.key}`}
                  className="overflow-hidden transition-[max-height] duration-300 ease-in-out"
                  style={{ maxHeight: compact ? 0 : maxH }}
                  role="group"
                  aria-label={section.label}
                >
                  <ul className="mt-1 space-y-1 pl-4">
                    {section.items.map(({ to, label, icon: Icon }) => {
                      const active = itemIsActive(to);
                      return (
                        <li key={to}>
                          <NavLink
                            to={to}
                            aria-current={active ? "page" : undefined}
                            className={[
                              "relative group flex items-center gap-3 rounded-md px-3 py-2 transition",
                              active
                                ? "bg-primary/10 text-sidebar-active font-medium"
                                : "hover:bg-sidebar-hover",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                            ].join(" ")}
                            title={label}
                          >
                            {active && (
                              <span
                                className="absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded bg-primary"
                                aria-hidden
                              />
                            )}
                            <Icon size={18} />
                            {!compact && (
                              <span className="truncate text-[13px] leading-5">
                                {label}
                              </span>
                            )}
                            {compact && (
                              <span className="pointer-events-none absolute left-full top-1/2 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-surface px-2 py-1 text-xs opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                                {label}
                              </span>
                            )}
                          </NavLink>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </section>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
