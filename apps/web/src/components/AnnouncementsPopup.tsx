import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { toast } from 'react-hot-toast';
import { getEmployee } from "../lib/auth";

type Announcement = {
  _id: string;
  title: string;
  message: string;
  createdAt: string;
  expiresAt?: string | null;
};

export default function AnnouncementsPopup() {
  const u = getEmployee();
  const [list, setList] = useState<Announcement[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lsKey = useMemo(() => {
    if (!u?.id) return null;
    const company = u.company || "none";
    return `ann:lastSeen:${company}:${u.id}`;
  }, [u?.id, u?.company]);

  useEffect(() => {
    // fetch only for logged-in users with a company
    if (!u?.id || !u?.company) return;
    (async () => {
      try {
        setLoading(true);
        const res = await api.get("/announcements");
        const anns: Announcement[] = res.data?.announcements || [];
        // Sort newest first
        anns.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setList(anns);

        const lastSeenStr = lsKey ? localStorage.getItem(lsKey) : null;
        const lastSeen = lastSeenStr ? new Date(lastSeenStr).getTime() : 0;
        const newest = anns.length ? new Date(anns[0].createdAt).getTime() : 0;
        if (newest > lastSeen && anns.length) setOpen(true);
      } catch (e: any) {
        const msg = e?.response?.data?.error || "Failed to load announcements";
        setError(msg);
        toast.error(msg);
      } finally {
        setLoading(false);
      }
    })();
  }, [u?.id, u?.company, lsKey]);

  if (!open || loading || error || !list.length) return null;

  const newestCreatedAt = list.length ? list[0].createdAt : undefined;
  const unseen = (() => {
    const lastSeenStr = lsKey ? localStorage.getItem(lsKey) : null;
    const lastSeen = lastSeenStr ? new Date(lastSeenStr).getTime() : 0;
    return list.filter((a) => new Date(a.createdAt).getTime() > lastSeen);
  })();

  function dismiss() {
    if (lsKey && newestCreatedAt) localStorage.setItem(lsKey, newestCreatedAt);
    setOpen(false);
  }

  const goTo = (u?.primaryRole === "ADMIN" || u?.primaryRole === "SUPERADMIN") ? "/admin/announcements" : "/app/announcements";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={dismiss} />
      <div className="relative max-w-xl w-[92%] bg-surface border border-border rounded-lg shadow-xl p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-lg font-semibold">{unseen.length > 1 ? `You have ${unseen.length} new announcements` : "New announcement"}</h3>
          <button onClick={dismiss} className="text-sm text-muted hover:text-text">Close</button>
        </div>
        <div className="mt-3 max-h-80 overflow-auto space-y-3">
          {unseen.map((a) => (
            <div key={a._id} className="p-3 rounded-md border border-border bg-bg">
              <div className="font-medium">{a.title}</div>
              <div className="text-xs text-muted">{new Date(a.createdAt).toLocaleString()} {a.expiresAt ? `• Expires ${new Date(a.expiresAt).toLocaleString()}` : ""}</div>
              <div className="mt-2 whitespace-pre-wrap text-sm">{a.message}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between">
          <Link to={goTo} className="text-primary hover:underline">View all</Link>
          <button onClick={dismiss} className="h-9 px-4 rounded-md bg-primary text-white">Dismiss</button>
        </div>
      </div>
    </div>
  );
}
