import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../lib/api";

type Notification = {
  _id: string;
  type?: string;
  title: string;
  message?: string;
  link?: string;
  readAt?: string | null;
  createdAt?: string;
};

function formatWhen(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function resolveHref(baseShell: "/app" | "/admin", link?: string) {
  if (!link) return "";
  if (link.startsWith("/app/") || link === "/app") return link;
  if (link.startsWith("/admin/") || link === "/admin") return link;
  if (link.startsWith("/")) return `${baseShell}${link}`;
  return `${baseShell}/${link}`;
}

export default function NotificationBell() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const baseShell = useMemo<"/app" | "/admin">(() => {
    if (pathname.startsWith("/admin")) return "/admin";
    return "/app";
  }, [pathname]);

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const ref = useRef<HTMLDivElement>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get("/notifications", { params: { limit: 20 } });
      setItems(res.data.notifications || []);
      setUnreadCount(res.data.unreadCount || 0);
    } catch {
      // ignore in navbar
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // initial prefetch
    load();
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => load(), 30000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (!open) return;
    load();
  }, [open]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  async function markAllRead() {
    try {
      await api.post("/notifications/read-all");
      await load();
    } catch {
      // ignore
    }
  }

  async function onClickItem(n: Notification) {
    console.log("dd", n);
    try {
      if (!n.readAt) {
        await api.put(`/notifications/${n._id}/read`);
      }
    } catch {
      // ignore
    } finally {
      setOpen(false);
      const href = resolveHref(baseShell, n.link);
      if (href) navigate(href);
      load();
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative inline-flex items-center justify-center h-9 w-9 rounded-md border border-border bg-surface hover:bg-bg"
        aria-label="Notifications"
        aria-expanded={open}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-error text-white text-[11px] leading-[18px] text-center">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[min(420px,92vw)] rounded-md border border-border bg-surface shadow-lg z-50 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-bg">
            <div className="text-sm font-semibold">Notifications</div>
            <button
              onClick={markAllRead}
              className="h-8 px-2 rounded-md border border-border bg-surface hover:bg-bg text-xs inline-flex items-center gap-1"
              title="Mark all as read"
              disabled={unreadCount === 0}
            >
              <CheckCheck size={14} />
              Mark all
            </button>
          </div>

          <div className="max-h-[50vh] overflow-y-auto">
            {loading ? (
              <div className="px-4 py-6 text-sm text-muted-foreground">
                Loading…
              </div>
            ) : items.length === 0 ? (
              <div className="px-4 py-6 text-sm text-muted-foreground">
                No notifications yet.
              </div>
            ) : (
              items.map((n) => {
                const when = formatWhen(n.createdAt);
                const unread = !n.readAt;
                return (
                  <button
                    key={n._id}
                    type="button"
                    onClick={() => onClickItem(n)}
                    className={[
                      "w-full text-left px-4 py-3 border-b border-border/70 hover:bg-bg",
                      unread ? "bg-primary/5" : "bg-surface",
                    ].join(" ")}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{n.title}</div>
                        {!!n.message && (
                          <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                            {n.message}
                          </div>
                        )}
                        {when && (
                          <div className="text-[11px] text-muted-foreground mt-1">
                            {when}
                          </div>
                        )}
                      </div>
                      {unread && (
                        <span className="mt-1 h-2 w-2 rounded-full bg-primary" />
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
