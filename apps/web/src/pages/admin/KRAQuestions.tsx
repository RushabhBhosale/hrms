import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { Th, Td, SkeletonRows } from "../../components/utils/Table";
import { toast } from "react-hot-toast";
import { Trash2, Pencil } from "lucide-react";

type QuestionRow = {
  questionKey: string;
  title: string;
  description?: string;
  roleKey?: string;
  count: number;
  createdAt?: string;
  updatedAt?: string;
};

function fmtDate(value?: string) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString();
}

export default function KRAQuestions() {
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: "", description: "" });
  const [saving, setSaving] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  useEffect(() => {
    loadQuestions();
  }, []);

  async function loadQuestions() {
    try {
      setLoading(true);
      const res = await api.get("/performance/questions");
      setQuestions(res.data?.questions || []);
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Failed to load questions");
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return questions
      .filter((item) => {
        if (!q) return true;
        return (
          item.title.toLowerCase().includes(q) ||
          (item.roleKey || "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  }, [questions, search]);

  function startEdit(row: QuestionRow) {
    setEditingKey(row.questionKey);
    setDraft({
      title: row.title,
      description: row.description || "",
    });
  }

  async function saveEdit() {
    if (!editingKey) return;
    if (!draft.title.trim()) {
      toast.error("Title is required");
      return;
    }
    try {
      setSaving(true);
      await api.patch(`/performance/questions/${editingKey}`, {
        title: draft.title.trim(),
        description: draft.description.trim() || undefined,
      });
      toast.success("Question updated");
      setEditingKey(null);
      await loadQuestions();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Failed to update question");
    } finally {
      setSaving(false);
    }
  }

  async function deleteQuestion(questionKey: string) {
    if (!window.confirm("Delete this question for all employees?")) return;
    try {
      setDeletingKey(questionKey);
      await api.delete(`/performance/questions/${questionKey}`);
      toast.success("Question deleted");
      await loadQuestions();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Failed to delete question");
    } finally {
      setDeletingKey(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-3xl font-bold">KRA Question Bank</h2>
          <p className="text-sm text-muted-foreground">
            See all questions added by admins. Edit or delete them in one place.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            to="/admin/kras"
            className="h-10 rounded-md bg-primary px-4 py-2 text-sm text-white flex items-center"
          >
            Add KRA
          </Link>
          <input
            className="h-10 rounded-md border border-border bg-surface px-3 text-sm"
            placeholder="Search title or role"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-bg text-left">
              <Th className="min-w-[200px]">Title</Th>
              <Th>Description</Th>
              <Th>Role</Th>
              <Th>Assigned</Th>
              <Th>Created</Th>
              <Th>Updated</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonRows rows={4} cols={7} />
            ) : !filtered.length ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-6 py-8 text-center text-muted-foreground"
                >
                  No questions found.
                </td>
              </tr>
            ) : (
              filtered.map((row) => {
                const isEditing = editingKey === row.questionKey;
                return (
                  <tr
                    key={row.questionKey}
                    className="border-t border-border/60 align-top"
                  >
                    <Td className="font-semibold">
                      {isEditing ? (
                        <input
                          className="w-full rounded-md border border-border bg-surface px-2 py-1"
                          value={draft.title}
                          onChange={(e) =>
                            setDraft((p) => ({ ...p, title: e.target.value }))
                          }
                        />
                      ) : (
                        row.title
                      )}
                    </Td>
                    <Td className="text-xs text-muted-foreground whitespace-pre-wrap">
                      {isEditing ? (
                        <textarea
                          className="w-full rounded-md border border-border bg-surface px-2 py-1 text-xs"
                          rows={3}
                          value={draft.description}
                          onChange={(e) =>
                            setDraft((p) => ({
                              ...p,
                              description: e.target.value,
                            }))
                          }
                        />
                      ) : (
                        row.description || "—"
                      )}
                    </Td>
                    <Td className="text-xs">{row.roleKey || "—"}</Td>
                    <Td className="text-xs">{row.count}</Td>
                    <Td className="text-xs text-muted-foreground">
                      {fmtDate(row.createdAt)}
                    </Td>
                    <Td className="text-xs text-muted-foreground">
                      {fmtDate(row.updatedAt)}
                    </Td>
                    <Td className="text-xs">
                      {isEditing ? (
                        <div className="flex gap-2">
                          <button
                            className="rounded-md bg-primary px-3 py-1 text-white text-xs disabled:opacity-60"
                            onClick={saveEdit}
                            disabled={saving}
                          >
                            {saving ? "Saving…" : "Save"}
                          </button>
                          <button
                            className="rounded-md border border-border px-3 py-1 text-xs"
                            onClick={() => setEditingKey(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <button
                            className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1 text-xs"
                            onClick={() => startEdit(row)}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-60"
                            onClick={() => deleteQuestion(row.questionKey)}
                            disabled={deletingKey === row.questionKey}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </Td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
