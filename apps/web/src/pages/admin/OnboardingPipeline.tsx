import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { api } from "../../lib/api";
import { Field } from "../../components/utils/Field";
import { SkeletonRows, Td, Th } from "../../components/utils/Table";
import {
  ONBOARDING_STATUS_OPTIONS,
  type OnboardingCandidate,
  type OnboardingStatus,
} from "../../types/onboarding";

type ComposerState = {
  candidate: OnboardingCandidate;
  subject: string;
  body: string;
  status: OnboardingStatus;
  includeOfferPdf: boolean;
  offerPosition: string;
  offerStartDate: string;
  offerCompensation: string;
};

const statusTone: Record<OnboardingStatus, string> = {
  INTERVIEW: "bg-bg text-muted-foreground",
  INTERVIEWED: "bg-warning/10 text-warning",
  OFFER_SENT: "bg-accent/10 text-accent",
  OFFER_ACCEPTED: "bg-secondary/10 text-secondary",
};

const statusLabels: Record<OnboardingStatus, string> = {
  INTERVIEW: "Interview",
  INTERVIEWED: "Interviewed",
  OFFER_SENT: "Offer sent",
  OFFER_ACCEPTED: "Offer accepted",
};

function formatDate(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

const defaultEmailBody =
  "Hi there,\n\nWe're excited to keep you in the loop before your first day. If you have any questions or need anything, just reply to this email.\n\nThanks,\nPeople Ops";

export default function OnboardingPipeline() {
  const navigate = useNavigate();
  const [candidates, setCandidates] = useState<OnboardingCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [statusUpdating, setStatusUpdating] = useState<string | null>(null);
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    load();
  }, []);

  const statusCounts = useMemo(() => {
    const base: Record<OnboardingStatus, number> = {
      INTERVIEW: 0,
      INTERVIEWED: 0,
      OFFER_SENT: 0,
      OFFER_ACCEPTED: 0,
    };
    candidates.forEach((c) => {
      base[c.status] = (base[c.status] || 0) + 1;
    });
    return base;
  }, [candidates]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return candidates;
    return candidates.filter((c) => {
      return (
        c.name.toLowerCase().includes(term) ||
        c.email.toLowerCase().includes(term) ||
        (c.notes || "").toLowerCase().includes(term) ||
        statusLabels[c.status].toLowerCase().includes(term)
      );
    });
  }, [q, candidates]);

  async function load() {
    try {
      setLoading(true);
      setErr(null);
      const res = await api.get("/onboarding/candidates");
      setCandidates(res.data?.candidates || []);
    } catch (e: any) {
      const msg = e?.response?.data?.error || "Failed to load onboarding list";
      setErr(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  async function updateStatus(id: string, status: OnboardingStatus) {
    setStatusUpdating(id);
    try {
      const res = await api.put(
        `/onboarding/candidates/${id}`,
        { status },
        { enableSuccessToast: true },
      );
      const candidate = res.data?.candidate as OnboardingCandidate | undefined;
      if (candidate) {
        setCandidates((prev) =>
          prev.map((c) => (c.id === candidate.id ? candidate : c)),
        );
      }
    } catch (e: any) {
      const msg = e?.response?.data?.error || "Failed to update status";
      toast.error(msg);
    } finally {
      setStatusUpdating(null);
    }
  }

  function openComposer(candidate: OnboardingCandidate) {
    setComposer({
      candidate,
      subject:
        candidate.lastEmailSubject ||
        `Offer details for ${candidate.name.split(" ")[0] || "you"}`,
      body:
        candidate.lastEmailBody ||
        defaultEmailBody.replace("Hi there", `Hi ${candidate.name || "there"}`),
      status: candidate.status,
      includeOfferPdf: true,
      offerPosition: "",
      offerStartDate: "",
      offerCompensation: "",
    });
  }

  async function sendEmail() {
    if (!composer) return;
    setSending(true);
    try {
      const res = await api.post(
        `/onboarding/candidates/${composer.candidate.id}/send-email`,
        {
          subject: composer.subject.trim(),
          body: composer.body.trim(),
          status: composer.status,
          includeOfferPdf: composer.includeOfferPdf,
          offerPosition: composer.offerPosition.trim(),
          offerStartDate: composer.offerStartDate,
          offerCompensation: composer.offerCompensation.trim(),
        },
        { enableSuccessToast: true },
      );
      const candidate = res.data?.candidate as OnboardingCandidate | undefined;
      if (candidate) {
        setCandidates((prev) =>
          prev.map((c) => (c.id === candidate.id ? candidate : c)),
        );
      }
      setComposer(null);
    } catch (e: any) {
      const msg = e?.response?.data?.error || "Failed to send email";
      toast.error(msg);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-3xl font-bold">Onboarding Pipeline</h2>
          <p className="text-sm text-muted-foreground">
            Track candidates before they join, update stages, and email offer
            PDFs.
          </p>
        </div>
        <div className="flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, email, status…"
            className="h-10 w-64 rounded-md border border-border bg-surface px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            onClick={() => navigate("/admin/onboarding/add")}
            className="h-10 rounded-md bg-primary px-4 text-white"
          >
            Add candidate
          </button>
        </div>
      </div>

      {err && (
        <div className="rounded-md border border-error/20 bg-error/10 px-4 py-2 text-sm text-error">
          {err}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        {ONBOARDING_STATUS_OPTIONS.map((opt) => (
          <div
            key={opt.value}
            className="rounded-lg border border-border bg-surface px-4 py-3 shadow-sm"
          >
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">{opt.label}</div>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusTone[opt.value]}`}
              >
                {statusLabels[opt.value]}
              </span>
            </div>
            <div className="text-3xl font-bold mt-2">
              {statusCounts[opt.value] || 0}
            </div>
          </div>
        ))}
      </div>

      <section className="rounded-lg border border-border bg-surface shadow-sm overflow-hidden">
        <div className="border-b border-border px-5 py-4 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">Pipeline</h3>
            <p className="text-sm text-muted-foreground">
              Manage interview statuses and send reminder emails.
            </p>
          </div>
          <span className="text-sm text-muted-foreground">
            {loading
              ? "Loading..."
              : `${filtered.length} candidate${filtered.length === 1 ? "" : "s"}`}
          </span>
        </div>
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg">
              <tr className="text-left">
                <Th>Name</Th>
                <Th>Email</Th>
                <Th>Status</Th>
                <Th>Last email</Th>
                <Th>Notes</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows rows={5} cols={6} />
              ) : filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-6 text-center text-muted-foreground"
                  >
                    {q
                      ? "No candidates match that search."
                      : "No onboarding candidates yet."}
                  </td>
                </tr>
              ) : (
                filtered.map((c) => (
                  <tr key={c.id} className="border-t border-border/70">
                    <Td className="font-medium">{c.name}</Td>
                    <Td>
                      <div className="truncate">{c.email}</div>
                    </Td>
                    <Td>
                      <select
                        className="rounded-md border border-border bg-surface px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-primary"
                        value={c.status}
                        onChange={(e) =>
                          updateStatus(c.id, e.target.value as OnboardingStatus)
                        }
                        disabled={statusUpdating === c.id}
                      >
                        {ONBOARDING_STATUS_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </Td>
                    <Td className="whitespace-nowrap">
                      <div className="text-sm font-medium">
                        {c.lastEmailSubject || "—"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatDate(c.lastEmailSentAt)}
                      </div>
                    </Td>
                    <Td>
                      {c.notes ? (
                        <div className="text-sm">{c.notes}</div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </Td>
                    <Td className="space-y-2">
                      <div>
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone[c.status]}`}
                        >
                          {statusLabels[c.status]}
                        </span>
                      </div>
                      <button
                        className="inline-flex h-9 items-center rounded-md border border-border bg-surface px-3 text-sm hover:bg-bg"
                        onClick={() => openComposer(c)}
                      >
                        Send email
                      </button>
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {composer && (
        <div className="fixed inset-0 z-30 flex items-start justify-center bg-black/40 px-4 py-10">
          <div className="w-full max-w-2xl rounded-xl border border-border bg-surface shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <div className="text-xs uppercase text-muted-foreground">
                  Send to
                </div>
                <div className="text-lg font-semibold">
                  {composer.candidate.name}
                </div>
                <div className="text-sm text-muted-foreground">
                  {composer.candidate.email}
                </div>
              </div>
              <button
                className="rounded-md border border-border bg-bg px-3 py-1 text-sm hover:bg-bg/70"
                onClick={() => setComposer(null)}
                disabled={sending}
              >
                Close
              </button>
            </div>
            <div className="px-5 py-5 space-y-4">
              <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
                <Field label="Subject">
                  <input
                    className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                    value={composer.subject}
                    onChange={(e) =>
                      setComposer((c) =>
                        c ? { ...c, subject: e.target.value } : null,
                      )
                    }
                  />
                </Field>
                <Field label="Update status after sending">
                  <select
                    className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                    value={composer.status}
                    onChange={(e) =>
                      setComposer((c) =>
                        c
                          ? { ...c, status: e.target.value as OnboardingStatus }
                          : null,
                      )
                    }
                  >
                    {ONBOARDING_STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="Message">
                <textarea
                  rows={10}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                  value={composer.body}
                  onChange={(e) =>
                    setComposer((c) =>
                      c ? { ...c, body: e.target.value } : null,
                    )
                  }
                />
                <p className="text-xs text-muted-foreground">
                  We'll send this from your company SMTP settings if configured.
                </p>
              </Field>

              <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-bg px-3 py-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={composer.includeOfferPdf}
                    onChange={(e) =>
                      setComposer((c) =>
                        c ? { ...c, includeOfferPdf: e.target.checked } : null,
                      )
                    }
                  />
                  Attach offer letter PDF (with logo)
                </label>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <Field label="Role / designation">
                  <input
                    className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                    placeholder="e.g. Frontend Engineer"
                    value={composer.offerPosition}
                    onChange={(e) =>
                      setComposer((c) =>
                        c ? { ...c, offerPosition: e.target.value } : null,
                      )
                    }
                    disabled={!composer.includeOfferPdf}
                  />
                </Field>
                <Field label="Start date">
                  <input
                    type="date"
                    className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                    value={composer.offerStartDate}
                    onChange={(e) =>
                      setComposer((c) =>
                        c ? { ...c, offerStartDate: e.target.value } : null,
                      )
                    }
                    disabled={!composer.includeOfferPdf}
                  />
                </Field>
                <Field label="Compensation">
                  <input
                    className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                    placeholder="e.g. ₹12 LPA"
                    value={composer.offerCompensation}
                    onChange={(e) =>
                      setComposer((c) =>
                        c ? { ...c, offerCompensation: e.target.value } : null,
                      )
                    }
                    disabled={!composer.includeOfferPdf}
                  />
                </Field>
              </div>

              <div className="flex items-center justify-end gap-3">
                <button
                  className="h-10 rounded-md border border-border bg-surface px-4 text-sm hover:bg-bg"
                  onClick={() => setComposer(null)}
                  disabled={sending}
                >
                  Cancel
                </button>
                <button
                  className="h-10 rounded-md bg-primary px-4 text-white disabled:opacity-60"
                  onClick={sendEmail}
                  disabled={
                    sending || !composer.subject.trim() || !composer.body.trim()
                  }
                >
                  {sending ? "Sending..." : "Send email"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
