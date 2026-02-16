import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { api } from "../../lib/api";
import { Field } from "../../components/utils/Field";
import {
  ONBOARDING_STATUS_OPTIONS,
  type OnboardingStatus,
} from "../../types/onboarding";

const defaultEmailBody =
  "Hi there,\n\nWe're excited to keep you in the loop before your first day. If you have any questions or need anything, just reply to this email.\n\nThanks,\nPeople Ops";

type FormState = {
  name: string;
  email: string;
  status: OnboardingStatus;
  notes: string;
  sendEmail: boolean;
  emailSubject: string;
  emailBody: string;
  includeOfferPdf: boolean;
  offerPosition: string;
  offerStartDate: string;
  offerCompensation: string;
};

export default function OnboardingAdd() {
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>({
    name: "",
    email: "",
    status: "INTERVIEW",
    notes: "",
    sendEmail: true,
    emailSubject: "Next steps with our team",
    emailBody: defaultEmailBody,
    includeOfferPdf: true,
    offerPosition: "",
    offerStartDate: "",
    offerCompensation: "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      const payload = {
        ...form,
        name: form.name.trim(),
        email: form.email.trim(),
        notes: form.notes.trim(),
        emailSubject: form.emailSubject.trim(),
        emailBody: form.emailBody.trim(),
        offerPosition: form.offerPosition.trim(),
        offerCompensation: form.offerCompensation.trim(),
        offerStartDate: form.offerStartDate,
      };
      await api.post("/onboarding/candidates", payload, {
        enableSuccessToast: true,
      });
      toast.success("Candidate saved");
      setForm({
        name: "",
        email: "",
        status: "INTERVIEW",
        notes: "",
        sendEmail: true,
        emailSubject: "Next steps with our team",
        emailBody: defaultEmailBody,
        includeOfferPdf: true,
        offerPosition: "",
        offerStartDate: "",
        offerCompensation: "",
      });
    } catch (e: any) {
      const msg = e?.response?.data?.error || "Failed to save candidate";
      setErr(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  const emailDisabled = !form.sendEmail;
  const pdfDisabled = emailDisabled || !form.includeOfferPdf;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-3xl font-bold">Add Candidate</h2>
          <p className="text-sm text-muted-foreground">
            Capture basic details, stage, and optionally email an offer letter
            PDF with your logo.
          </p>
        </div>
        <button
          className="h-10 rounded-md border border-border bg-surface px-4 text-sm font-medium hover:bg-bg"
          onClick={() => navigate("/admin/onboarding/pipeline")}
        >
          View pipeline
        </button>
      </div>

      {err && (
        <div className="rounded-md border border-error/20 bg-error/10 px-4 py-2 text-sm text-error">
          {err}
        </div>
      )}

      <section className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="border-b border-border px-5 py-4">
          <h3 className="text-lg font-semibold">Candidate details</h3>
          <p className="text-sm text-muted-foreground">
            We'll keep them separate from employees until they join.
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-5">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Full name" required>
              <input
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                placeholder="Candidate name"
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
                required
              />
            </Field>
            <Field label="Email" required>
              <input
                type="email"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                placeholder="candidate@example.com"
                value={form.email}
                onChange={(e) =>
                  setForm((f) => ({ ...f, email: e.target.value }))
                }
                required
              />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Stage" required>
              <select
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                value={form.status}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    status: e.target.value as OnboardingStatus,
                  }))
                }
              >
                {ONBOARDING_STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Notes">
              <input
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                placeholder="Offer highlights, tentative start date, etc."
                value={form.notes}
                onChange={(e) =>
                  setForm((f) => ({ ...f, notes: e.target.value }))
                }
              />
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-bg px-3 py-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.sendEmail}
                onChange={(e) =>
                  setForm((f) => ({ ...f, sendEmail: e.target.checked }))
                }
              />
              Send an email right away
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.includeOfferPdf}
                disabled={!form.sendEmail}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    includeOfferPdf: e.target.checked,
                  }))
                }
              />
              Attach offer letter PDF (with logo)
            </label>
          </div>

          <Field label="Email subject">
            <input
              className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
              placeholder="Welcome to the team"
              value={form.emailSubject}
              onChange={(e) =>
                setForm((f) => ({ ...f, emailSubject: e.target.value }))
              }
              disabled={emailDisabled}
            />
          </Field>

          <Field label="Email body">
            <textarea
              className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
              rows={6}
              value={form.emailBody}
              onChange={(e) =>
                setForm((f) => ({ ...f, emailBody: e.target.value }))
              }
              disabled={emailDisabled}
            />
          </Field>

          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Role / designation">
              <input
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                placeholder="e.g. Frontend Engineer"
                value={form.offerPosition}
                onChange={(e) =>
                  setForm((f) => ({ ...f, offerPosition: e.target.value }))
                }
                disabled={pdfDisabled}
              />
            </Field>
            <Field label="Start date">
              <input
                type="date"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                value={form.offerStartDate}
                onChange={(e) =>
                  setForm((f) => ({ ...f, offerStartDate: e.target.value }))
                }
                disabled={pdfDisabled}
              />
            </Field>
            <Field label="Compensation">
              <input
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                placeholder="e.g. ₹12 LPA"
                value={form.offerCompensation}
                onChange={(e) =>
                  setForm((f) => ({ ...f, offerCompensation: e.target.value }))
                }
                disabled={pdfDisabled}
              />
            </Field>
          </div>
          <p className="text-xs text-muted-foreground">
            Offer PDF will include your company logo if configured under Company
            Branding.
          </p>

          <div className="pt-2">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-white disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save candidate"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
