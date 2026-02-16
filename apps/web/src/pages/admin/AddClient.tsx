import { useState } from "react";
import { api } from "../../lib/api";
import { toast } from "react-hot-toast";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/button";

export default function AddClient() {
  const nav = useNavigate();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    address: "",
    website: "",
    pointOfContact: "",
    pointEmail: "",
    pointPhone: "",
    bio: "",
    notes: "",
  });
  const [logoFile, setLogoFile] = useState<File | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error("Client name is required");
      return;
    }
    const emailOk = (val: string) =>
      !val.trim() || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(val.trim());
    const phoneDigits = (val: string) => val.replace(/\D/g, "");
    const phoneVal = phoneDigits(form.phone);
    const pointPhoneVal = phoneDigits(form.pointPhone);
    if (form.phone.trim() && phoneVal.length !== 10) {
      toast.error("Phone must be exactly 10 digits");
      return;
    }
    if (form.pointPhone.trim() && pointPhoneVal.length !== 10) {
      toast.error("Contact phone must be exactly 10 digits");
      return;
    }
    if (!emailOk(form.email)) {
      toast.error("Enter a valid client email");
      return;
    }
    if (!emailOk(form.pointEmail)) {
      toast.error("Enter a valid contact email");
      return;
    }
    if (logoFile) {
      if (!logoFile.type.startsWith("image/")) {
        toast.error("Logo must be an image file");
        return;
      }
      if (logoFile.size > 10 * 1024 * 1024) {
        toast.error("Logo must be 10MB or smaller");
        return;
      }
    }
    setSaving(true);
    const clean = (val: string) => val.trim() || undefined;
    try {
      const fd = new FormData();
      fd.append("name", form.name.trim());
      const appendIf = (key: string, val?: string) => {
        if (val) fd.append(key, val);
      };
      appendIf("email", clean(form.email));
      appendIf("phone", phoneVal || undefined);
      appendIf("address", clean(form.address));
      appendIf("website", clean(form.website));
      appendIf("pointOfContact", clean(form.pointOfContact));
      appendIf("pointEmail", clean(form.pointEmail));
      appendIf("pointPhone", pointPhoneVal || undefined);
      appendIf("bio", clean(form.bio));
      appendIf("notes", clean(form.notes));
      if (logoFile) fd.append("logo", logoFile);

      await api.post("/clients", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast.success("Client added");
      nav("/admin/clients");
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Failed to add client");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Add Client</h2>
          <p className="text-sm text-muted-foreground">
            Create a client so you can link projects and invoices.
          </p>
        </div>
        <Button asChild variant="outline" className="h-10">
          <Link to="/admin/clients">Back to Clients</Link>
        </Button>
      </div>

      <form
        onSubmit={submit}
        className="rounded-md border border-border bg-surface p-4 space-y-3"
      >
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm mb-1 required-label">Name</label>
            <input
              className="h-10 w-full rounded border border-border bg-bg px-3"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Client name"
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Email</label>
            <input
              className="h-10 w-full rounded border border-border bg-bg px-3"
              value={form.email}
              onChange={(e) =>
                setForm((f) => ({ ...f, email: e.target.value }))
              }
              type="email"
              placeholder="client@company.com"
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Phone</label>
            <input
              className="h-10 w-full rounded border border-border bg-bg px-3"
              value={form.phone}
              onChange={(e) =>
                setForm((f) => ({ ...f, phone: e.target.value }))
              }
              placeholder="+91 9999999999"
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Website</label>
            <input
              className="h-10 w-full rounded border border-border bg-bg px-3"
              value={form.website}
              onChange={(e) =>
                setForm((f) => ({ ...f, website: e.target.value }))
              }
              type="url"
              placeholder="https://company.com"
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Logo (upload)</label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
              className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-bg file:px-3 file:py-2 file:text-foreground"
            />
            <div className="text-xs text-muted-foreground mt-1">
              {logoFile ? `Selected: ${logoFile.name}` : "PNG/JPG up to 10MB"}
            </div>
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm mb-1">Office Address</label>
            <input
              className="h-10 w-full rounded border border-border bg-bg px-3"
              value={form.address}
              onChange={(e) =>
                setForm((f) => ({ ...f, address: e.target.value }))
              }
              placeholder="Billing address or key notes"
            />
          </div>
        </div>
        <div className="grid md:grid-cols-3 gap-3">
          <div>
            <label className="block text-sm mb-1">Point of Contact</label>
            <input
              className="h-10 w-full rounded border border-border bg-bg px-3"
              value={form.pointOfContact}
              onChange={(e) =>
                setForm((f) => ({ ...f, pointOfContact: e.target.value }))
              }
              placeholder="Primary contact name"
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Contact Email</label>
            <input
              className="h-10 w-full rounded border border-border bg-bg px-3"
              value={form.pointEmail}
              onChange={(e) =>
                setForm((f) => ({ ...f, pointEmail: e.target.value }))
              }
              type="email"
              placeholder="contact@company.com"
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Contact Phone</label>
            <input
              className="h-10 w-full rounded border border-border bg-bg px-3"
              value={form.pointPhone}
              onChange={(e) =>
                setForm((f) => ({ ...f, pointPhone: e.target.value }))
              }
              placeholder="+91 8888888888"
            />
          </div>
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm mb-1">Bio</label>
            <textarea
              className="w-full rounded border border-border bg-bg px-3 py-2"
              value={form.bio}
              onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
              rows={3}
              placeholder="Short description about the client"
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Notes</label>
            <textarea
              className="w-full rounded border border-border bg-bg px-3 py-2"
              value={form.notes}
              onChange={(e) =>
                setForm((f) => ({ ...f, notes: e.target.value }))
              }
              rows={3}
              placeholder="Any internal notes or preferences"
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-3">
          <button
            type="submit"
            disabled={saving}
            className="h-10 px-4 rounded-md border border-border bg-primary text-white text-sm disabled:opacity-60"
          >
            {saving ? "Saving…" : "Add Client"}
          </button>
        </div>
      </form>
    </div>
  );
}
