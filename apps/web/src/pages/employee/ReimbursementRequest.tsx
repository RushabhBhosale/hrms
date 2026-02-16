import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2, Paperclip, Plus, Trash2, Upload, ArrowLeft } from "lucide-react";
import { api } from "../../lib/api";
import { toast } from "react-hot-toast";

type ReimbursementType = {
  _id: string;
  name: string;
  description?: string;
  isActive?: boolean;
};

type ProjectRef = {
  _id: string;
  title: string;
};

const PROJECT_OPTION_CUSTOM = "__CUSTOM__";
const PROJECT_OPTION_NONE = "__NONE__";

export default function ReimbursementRequest() {
  const nav = useNavigate();
  const [types, setTypes] = useState<ReimbursementType[]>([]);
  const [projects, setProjects] = useState<ProjectRef[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(true);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [typesError, setTypesError] = useState<string | null>(null);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [files, setFiles] = useState<File[]>([]);
  const [form, setForm] = useState({
    typeId: "",
    amount: "",
    projectSelection: PROJECT_OPTION_NONE,
    projectOther: "",
    description: "",
    employeeNote: "",
  });

  async function loadTypes() {
    try {
      setLoadingTypes(true);
      setTypesError(null);
      const res = await api.get("/reimbursements/types");
      const list = res.data?.types || [];
      setTypes(list);
      if (!form.typeId && list.length) {
        setForm((p) => ({ ...p, typeId: list[0]._id }));
      }
    } catch (err: any) {
      setTypesError(err?.response?.data?.error || "Failed to load types");
    } finally {
      setLoadingTypes(false);
    }
  }

  async function loadProjects() {
    try {
      setLoadingProjects(true);
      setProjectsError(null);
      const res = await api.get("/projects", { params: { active: "true" } });
      const list: ProjectRef[] = (res.data?.projects || []).map((p: any) => ({
        _id: p._id,
        title: p.title,
      }));
      setProjects(list);
    } catch (err: any) {
      setProjectsError(err?.response?.data?.error || "Failed to load projects");
    } finally {
      setLoadingProjects(false);
    }
  }

  useEffect(() => {
    loadTypes();
    loadProjects();
  }, []);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files || []);
    if (!selected.length) return;
    const combined = [...files, ...selected].slice(0, 5);
    if (files.length + selected.length > 5) {
      toast.error("You can attach up to 5 files");
    }
    setFiles(combined);
    setFileInputKey((k) => k + 1);
  }

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  function resetForm() {
    setForm({
      typeId: types[0]?._id || "",
      amount: "",
      projectSelection: PROJECT_OPTION_NONE,
      projectOther: "",
      description: "",
      employeeNote: "",
    });
    setFiles([]);
    setFormError(null);
    setFileInputKey((k) => k + 1);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.typeId) {
      setFormError("Please choose a reimbursement type");
      return;
    }
    const amountNum = Number(form.amount);
    if (Number.isNaN(amountNum) || amountNum < 0) {
      setFormError("Enter a valid non-negative amount");
      return;
    }
    if (
      form.projectSelection === PROJECT_OPTION_CUSTOM &&
      !form.projectOther.trim()
    ) {
      setFormError("Enter a project name or pick an existing project");
      return;
    }
    try {
      setSubmitting(true);
      setFormError(null);
      const payload = new FormData();
      payload.append("typeId", form.typeId);
      payload.append("amount", amountNum.toString());
      if (form.description) payload.append("description", form.description);
      if (form.employeeNote) payload.append("employeeNote", form.employeeNote);

      if (form.projectSelection === PROJECT_OPTION_CUSTOM) {
        payload.append("projectName", form.projectOther.trim());
      } else if (form.projectSelection !== PROJECT_OPTION_NONE) {
        payload.append("projectId", form.projectSelection);
      }

      files.forEach((file) => payload.append("attachments", file));

      await api.post("/reimbursements", payload, {
        headers: { "Content-Type": "multipart/form-data" },
        enableSuccessToast: true,
      });
      resetForm();
      nav("/app/reimbursements");
    } catch (err: any) {
      setFormError(err?.response?.data?.error || "Failed to submit request");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">
            Reimbursements
          </p>
          <h2 className="text-3xl font-bold">Request reimbursement</h2>
          <p className="text-sm text-muted-foreground">
            Submit a new reimbursement and include receipts if needed.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/app/reimbursements"
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium"
          >
            <ArrowLeft size={16} />
            Back to list
          </Link>
        </div>
      </div>

      {formError && (
        <div className="rounded-md border border-error/20 bg-error/10 px-4 py-2 text-sm text-error">
          {formError}
        </div>
      )}

      <section className="rounded-lg border border-border bg-surface shadow-sm">
        <form onSubmit={submit} className="space-y-5 p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold">Details</h3>
              <p className="text-sm text-muted-foreground">
                Provide the basics; you can attach up to 5 files.
              </p>
            </div>
            <button
              type="submit"
              disabled={submitting || loadingTypes || types.length === 0}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-white disabled:opacity-60"
            >
              {submitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Plus size={16} />
                  Submit request
                </>
              )}
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <label className="text-sm font-medium required-label">
                Reimbursement type
              </label>
              <select
                className="h-10 w-full rounded-md border border-border bg-white px-3 text-sm"
                value={form.typeId}
                onChange={(e) => setForm((p) => ({ ...p, typeId: e.target.value }))}
                disabled={loadingTypes || types.length === 0 || submitting}
              >
                {types.length === 0 ? (
                  <option value="">No types available</option>
                ) : null}
                {types
                  .filter((t) => t.isActive !== false)
                  .map((t) => (
                    <option key={t._id} value={t._id}>
                      {t.name}
                    </option>
                  ))}
              </select>
              {types.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No reimbursement types yet. Please contact your admin.
                </p>
              ) : null}
              {typesError ? (
                <p className="text-xs text-error">{typesError}</p>
              ) : null}
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium required-label">
                Amount (Rs.)
              </label>
              <input
                className="h-10 w-full rounded-md border border-border bg-white px-3 text-sm"
                type="number"
                min={0}
                step="0.01"
                value={form.amount}
                onChange={(e) =>
                  setForm((p) => ({ ...p, amount: e.target.value }))
                }
                placeholder="e.g. 1200"
                disabled={submitting}
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Project</label>
              <select
                className="h-10 w-full rounded-md border border-border bg-white px-3 text-sm"
                value={form.projectSelection}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    projectSelection: e.target.value,
                  }))
                }
                disabled={loadingProjects || submitting}
              >
                <option value={PROJECT_OPTION_NONE}>No project / general</option>
                {projects.map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.title}
                  </option>
                ))}
                <option value={PROJECT_OPTION_CUSTOM}>Other / custom</option>
              </select>
              {loadingProjects ? (
                <p className="text-xs text-muted-foreground">Loading projects...</p>
              ) : null}
              {projectsError ? (
                <p className="text-xs text-error">{projectsError}</p>
              ) : null}
            </div>

            {form.projectSelection === PROJECT_OPTION_CUSTOM ? (
              <div className="space-y-1">
                <label className="text-sm font-medium required-label">
                  Custom project name
                </label>
                <input
                  className="h-10 w-full rounded-md border border-border bg-white px-3 text-sm"
                  value={form.projectOther}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, projectOther: e.target.value }))
                  }
                  placeholder="Enter project or client name"
                  disabled={submitting}
                />
              </div>
            ) : null}

            <div className="space-y-1 md:col-span-2">
              <label className="text-sm font-medium">Description</label>
              <textarea
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm"
                rows={2}
                value={form.description}
                onChange={(e) =>
                  setForm((p) => ({ ...p, description: e.target.value }))
                }
                placeholder="What is this reimbursement for?"
                disabled={submitting}
              />
            </div>

            <div className="space-y-1 md:col-span-2">
              <label className="text-sm font-medium">Note for admin</label>
              <textarea
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm"
                rows={2}
                value={form.employeeNote}
                onChange={(e) =>
                  setForm((p) => ({ ...p, employeeNote: e.target.value }))
                }
                placeholder="Optional message to include with your request"
                disabled={submitting}
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium">Attachments</label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  key={fileInputKey}
                  type="file"
                  multiple
                  onChange={handleFileChange}
                  disabled={submitting}
                  className="hidden"
                  id="reimbursement-attachments"
                />
                <label
                  htmlFor="reimbursement-attachments"
                  className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border bg-white px-3 py-2 text-sm font-medium shadow-sm"
                >
                  <Upload size={16} />
                  Upload files
                </label>
                <span className="text-xs text-muted-foreground">
                  Up to 5 files. Max size depends on your network.
                </span>
              </div>
              {files.length ? (
                <div className="flex flex-wrap gap-2">
                  {files.map((file, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-2 rounded-full bg-bg px-3 py-1 text-xs"
                    >
                      <Paperclip size={12} />
                      {file.name}
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-error"
                        onClick={() => removeFile(idx)}
                        aria-label="Remove file"
                      >
                        <Trash2 size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}
