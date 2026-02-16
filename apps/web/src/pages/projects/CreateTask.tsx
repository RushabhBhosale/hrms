import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { toast } from "react-hot-toast";

import { api } from "../../lib/api";
import { getEmployee, hasPermission } from "../../lib/auth";
import type { PrimaryRole } from "../../lib/auth";
import ReportingPersonMultiSelect from "../../components/ReportingPersonMultiSelect";
import { BackButton } from "../../components/utils/BackButton";
import { Button } from "../../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";

type EmployeeLite = {
  id: string;
  name: string;
  email: string;
  subRoles: string[];
  primaryRole: PrimaryRole;
};

type ProjectLite = {
  _id: string;
  title: string;
  teamLead: string;
  members?: string[];
};

type Priority = "URGENT" | "FIRST" | "SECOND" | "LEAST";

type TaskLite = {
  _id: string;
  title: string;
  description?: string;
  parentTask?: string | null;
  assignedTo: string | string[];
  priority?: Priority;
  estimatedTimeMinutes?: number;
  status?: "PENDING" | "INPROGRESS" | "DONE";
  isMeetingDefault?: boolean;
};

export default function CreateTask() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const viewer = getEmployee();
  const parentTaskId = sp.get("parent") || "";
  const editingTaskId = sp.get("taskId") || "";
  const isEditing = Boolean(editingTaskId);
  const isSubtaskBatch = Boolean(parentTaskId) && !isEditing;
  const isMainEdit = isEditing && !isSubtaskBatch;

  type SubRow = {
    id: string;
    title: string;
    assignees: string[];
    priority: Priority | "";
    estimatedHours: string;
  };

  const [project, setProject] = useState<ProjectLite | null>(null);
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignees, setAssignees] = useState<string[]>([]);
  const [priority, setPriority] = useState<Priority>("SECOND");
  const [estimatedHours, setEstimatedHours] = useState("");
  const [subtasks, setSubtasks] = useState<SubRow[]>([
    {
      id: "row-1",
      title: "",
      assignees: [],
      priority: "SECOND",
      estimatedHours: "",
    },
  ]);
  const [currentParentId, setCurrentParentId] = useState<string>("");
  const [currentParentTitle, setCurrentParentTitle] = useState<string>("");
  const [parentAssignees, setParentAssignees] = useState<string[]>([]);
  const [editSubtasks, setEditSubtasks] = useState<SubRow[]>([
    {
      id: "edit-row-1",
      title: "",
      assignees: [],
      priority: "SECOND",
      estimatedHours: "",
    },
  ]);
  const [lockMeetingEdit, setLockMeetingEdit] = useState(false);

  const basePath = location.pathname.startsWith("/admin") ? "/admin" : "/app";
  const tasksPath = id
    ? `${basePath}/projects/${id}/tasks`
    : `${basePath}/projects`;

  useEffect(() => {
    if (!id) return;
    async function load() {
      setLoading(true);
      setErr(null);
      try {
        const [projRes, empRes, taskRes] = await Promise.all([
          api.get(`/projects/${id}`),
          api.get("/companies/employees"),
          api.get(`/projects/${id}/tasks`, { params: { limit: 500 } }),
        ]);
        setProject(projRes.data.project);
        setEmployees(empRes.data.employees || []);
        const list: TaskLite[] = taskRes.data.tasks || [];
        const parent =
          parentTaskId &&
          list.find((t) => String(t._id) === String(parentTaskId));
        if (parent) {
          setCurrentParentId(parent._id);
          setCurrentParentTitle(parent.title || "Parent task");
          const assigned = Array.isArray(parent.assignedTo)
            ? parent.assignedTo
            : [String(parent.assignedTo || "")].filter(Boolean);
          setParentAssignees(assigned);
        } else if (parentTaskId) {
          setCurrentParentId(parentTaskId);
        }
        if (editingTaskId) {
          const target = list.find(
            (t) => String(t._id) === String(editingTaskId),
          );
          if (target) {
            if (target.isMeetingDefault) {
              setLockMeetingEdit(true);
              setFormError("Default meeting task cannot be edited.");
            }
            setTitle(target.title || "");
            setDescription(target.description || "");
            const assigned = Array.isArray(target.assignedTo)
              ? target.assignedTo
              : [String(target.assignedTo || "")].filter(Boolean);
            setAssignees(assigned);
            setPriority((target.priority || "SECOND") as Priority);
            setEstimatedHours(
              target.estimatedTimeMinutes
                ? String(
                    Math.round(((target.estimatedTimeMinutes || 0) / 60) * 10) /
                      10,
                  )
                : "",
            );
            if (target.parentTask) {
              setCurrentParentId(String(target.parentTask));
              const parent = list.find(
                (p) => String(p._id) === String(target.parentTask),
              );
              if (parent) setCurrentParentTitle(parent.title || "Parent task");
            }
          } else {
            setFormError("Task not found.");
          }
        }
      } catch (e: any) {
        setErr(e?.response?.data?.error || "Failed to load project details");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id, parentTaskId, editingTaskId]);

  const memberIds = useMemo(() => {
    if (!project) return [] as string[];
    const ids = new Set<string>();
    if (project.teamLead) ids.add(String(project.teamLead));
    (project.members || []).forEach((m) => ids.add(String(m)));
    return Array.from(ids);
  }, [project]);

  const memberOptions = useMemo(() => {
    return memberIds.map((memberId) => {
      const emp = employees.find((e) => e.id === memberId);
      return { value: memberId, label: emp?.name || "Member" };
    });
  }, [memberIds, employees]);

  useEffect(() => {
    if (!project) return;
    if (!isEditing && !isSubtaskBatch) {
      setAssignees(memberIds);
    }
  }, [project, memberIds, isEditing, isSubtaskBatch]);

  useEffect(() => {
    if (!isSubtaskBatch) return;
    setSubtasks([
      {
        id: "row-1",
        title: "",
        assignees: [],
        priority: "SECOND",
        estimatedHours: "",
      },
    ]);
  }, [isSubtaskBatch]);

  // Ensure subtasks never auto-pick parent assignees; keep them empty until user selects.
  useEffect(() => {
    if (!isSubtaskBatch) return;
    setSubtasks((rows) =>
      rows.map((r) => ({
        ...r,
        assignees: [],
      })),
    );
  }, [isSubtaskBatch, parentAssignees, memberIds]);

  const isAdminViewer = useMemo(() => {
    if (!viewer) return false;
    return (
      viewer.primaryRole === "ADMIN" || viewer.primaryRole === "SUPERADMIN"
    );
  }, [viewer]);

  const canCreateTask = useMemo(() => {
    if (!project || !viewer) return false;
    if (isAdminViewer) return true;
    const allowed = hasPermission(viewer, "tasks", "write");
    if (!allowed) return false;
    const isMember = memberIds.includes(String(viewer.id));
    return isMember;
  }, [project, viewer, memberIds, isAdminViewer]);

  function makeSubRow(initialAssignees: string[] = []): SubRow {
    return {
      id: `row-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      title: "",
      assignees: [...initialAssignees],
      priority: "SECOND",
      estimatedHours: "",
    };
  }

  function updateSubRow(rowId: string, patch: Partial<SubRow>) {
    setSubtasks((rows) =>
      rows.map((r) => (r.id === rowId ? { ...r, ...patch } : r)),
    );
  }

  function removeSubRow(rowId: string) {
    setSubtasks((rows) =>
      rows.length === 1 ? rows : rows.filter((r) => r.id !== rowId),
    );
  }

  function updateEditSubRow(rowId: string, patch: Partial<SubRow>) {
    setEditSubtasks((rows) =>
      rows.map((r) => (r.id === rowId ? { ...r, ...patch } : r)),
    );
  }

  function removeEditSubRow(rowId: string) {
    setEditSubtasks((rows) =>
      rows.length === 1 ? rows : rows.filter((r) => r.id !== rowId),
    );
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!id || !canCreateTask || lockMeetingEdit) return;
    setFormError(null);

    // Editing: allow adding new subtasks alongside the update
    if (isMainEdit) {
      if (!title.trim()) {
        setFormError("Task title is required.");
        return;
      }
      if (assignees.length === 0) {
        setFormError("Select at least one assignee.");
        return;
      }

      setSaving(true);
      try {
        const payload: Record<string, any> = {
          title: title.trim(),
          description: description.trim(),
          assignedTo: [...assignees],
          priority,
        };
        const hours = parseFloat(estimatedHours || "");
        if (isFinite(hours) && hours >= 0) payload.estimatedHours = hours;

        await api.put(`/projects/${id}/tasks/${editingTaskId}`, payload);

        // Add any new subtasks entered
        const validSubs = editSubtasks
          .map((row) => ({ ...row, title: row.title.trim() }))
          .filter((row) => row.title);
        if (
          validSubs.length > 0 &&
          validSubs.some((row) => row.assignees.length === 0)
        ) {
          setFormError("Select assignees for each new subtask.");
          throw new Error("Select assignees for each new subtask.");
        }
        for (const row of validSubs) {
          const subPayload: Record<string, any> = {
            title: row.title,
            description: "",
            assignedTo: row.assignees,
            priority: row.priority || undefined,
            parentTask: editingTaskId,
          };
          const subHours = parseFloat(row.estimatedHours || "");
          if (isFinite(subHours) && subHours >= 0)
            subPayload.estimatedHours = subHours;
          await api.post(`/projects/${id}/tasks`, subPayload);
        }

        toast.success("Task updated");
        navigate(tasksPath, { replace: true });
      } catch (e: any) {
        setFormError(
          e?.response?.data?.error || e?.message || "Failed to save task",
        );
      } finally {
        setSaving(false);
      }
      return;
    }

    if (isSubtaskBatch) {
      const valid = subtasks
        .map((row) => ({
          ...row,
          title: row.title.trim(),
        }))
        .filter((row) => row.title);
      if (!valid.length) {
        setFormError("Add at least one subtask title.");
        return;
      }
      if (valid.some((row) => row.assignees.length === 0)) {
        setFormError("Select assignees for each subtask.");
        return;
      }
      setSaving(true);
      try {
        for (const row of valid) {
          const payload: Record<string, any> = {
            title: row.title,
            description: "",
            assignedTo: row.assignees,
            priority: row.priority || undefined,
            parentTask: currentParentId || parentTaskId,
          };
          const hours = parseFloat(row.estimatedHours || "");
          if (isFinite(hours) && hours >= 0) payload.estimatedHours = hours;
          await api.post(`/projects/${id}/tasks`, payload);
        }
        toast.success("Subtasks added");
        navigate(tasksPath, { replace: true });
      } catch (e: any) {
        setFormError(e?.response?.data?.error || "Failed to add subtasks");
      } finally {
        setSaving(false);
      }
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, any> = {
        title: title.trim(),
        description: description.trim(),
        assignedTo: [...assignees],
        priority,
      };
      const hours = parseFloat(estimatedHours || "");
      if (isFinite(hours) && hours >= 0) payload.estimatedHours = hours;
      if (currentParentId && !isEditing) payload.parentTask = currentParentId;
      if (isEditing) {
        await api.put(`/projects/${id}/tasks/${editingTaskId}`, payload);
        toast.success("Task updated");
      } else {
        await api.post(`/projects/${id}/tasks`, payload);
        toast.success("Task created");
      }
      navigate(tasksPath, { replace: true });
    } catch (e: any) {
      setFormError(e?.response?.data?.error || "Failed to save task");
    } finally {
      setSaving(false);
    }
  }

  const heading = isEditing
    ? "Edit Task"
    : isSubtaskBatch
      ? "Add Subtasks"
      : "Add Task";
  const subheading = isSubtaskBatch
    ? "Quickly add multiple subtasks under this task."
    : "Assign work to project members and set the initial priority.";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">{heading}</h2>
          <p className="text-sm text-muted-foreground">{subheading}</p>
        </div>
        <BackButton to={tasksPath} label="Back to Tasks" />
      </div>

      {err && (
        <div className="rounded-md border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
          {err}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-muted-foreground">
          Loading project details…
        </div>
      ) : !project ? (
        <div className="text-sm text-error">Project not found.</div>
      ) : (
        <form
          onSubmit={handleCreate}
          className="space-y-4 border border-border rounded-md bg-surface p-4"
        >
          <fieldset
            disabled={lockMeetingEdit || !canCreateTask}
            className="space-y-4"
          >
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Project</div>
              <div className="text-base font-semibold">{project.title}</div>
            </div>

            {currentParentId && (
              <div className="rounded-md border border-border bg-bg px-3 py-2 text-sm flex items-center justify-between">
                <div>
                  <div className="text-xs text-muted-foreground">Parent task</div>
                  <div className="font-medium">
                    {currentParentTitle || "Task"}
                  </div>
                </div>
                {parentAssignees.length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    Defaults to {parentAssignees.length} assignee
                    {parentAssignees.length > 1 ? "s" : ""}
                  </div>
                )}
              </div>
            )}

            {!canCreateTask && (
              <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
                You are not allowed to add tasks to this project.
              </div>
            )}

          {isSubtaskBatch ? (
            <div className="space-y-3">
              {subtasks.map((row, idx) => (
                <div
                  key={row.id}
                  className="rounded-md border border-border bg-bg px-3 py-3 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium">Subtask {idx + 1}</div>
                    {subtasks.length > 1 && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-auto px-1 text-xs"
                        onClick={() => removeSubRow(row.id)}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                  <div className="grid md:grid-cols-2 gap-3">
                    <input
                      className="h-10 w-full rounded border border-border bg-surface px-3 text-sm"
                      placeholder="Subtask title"
                      value={row.title}
                      onChange={(e) =>
                        updateSubRow(row.id, { title: e.target.value })
                      }
                      disabled={!canCreateTask}
                    />
                    <div className="flex items-center gap-2">
                      <input
                        className="h-10 w-full rounded border border-border bg-surface px-3 text-sm"
                        type="number"
                        min={0}
                        step={0.1}
                        placeholder="Est. hours (optional)"
                        value={row.estimatedHours}
                        onChange={(e) =>
                          updateSubRow(row.id, {
                            estimatedHours: e.target.value,
                          })
                        }
                        disabled={!canCreateTask}
                      />
                      <Select
                        value={row.priority}
                        onValueChange={(v) =>
                          updateSubRow(row.id, { priority: v as Priority })
                        }
                        disabled={!canCreateTask}
                      >
                        <SelectTrigger className="h-10 w-[140px] text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="URGENT">Urgent</SelectItem>
                          <SelectItem value="FIRST">First</SelectItem>
                          <SelectItem value="SECOND">Second</SelectItem>
                          <SelectItem value="LEAST">Least</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <ReportingPersonMultiSelect
                      options={memberOptions}
                      value={row.assignees}
                      onChange={(next) =>
                        updateSubRow(row.id, { assignees: next })
                      }
                      placeholder="Assign team members"
                      emptyMessage="No team members available"
                      disabled={!canCreateTask}
                    />
                    {row.assignees.length > 0 && (
                      <div className="mt-2 flex justify-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-auto text-xs"
                          onClick={() => updateSubRow(row.id, { assignees: [] })}
                          disabled={!canCreateTask}
                        >
                          Clear assignees
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              <Button
                type="button"
                variant="outline"
                onClick={() => setSubtasks((rows) => [...rows, makeSubRow()])}
                className="h-10 px-4 text-sm"
                disabled={!canCreateTask}
              >
                + Add another subtask
              </Button>
            </div>
          ) : isMainEdit ? (
            <>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm mb-1 required-label">
                    Task title
                  </label>
                  <input
                    className="w-full h-10 rounded border border-border bg-bg px-3"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Task title"
                    disabled={!canCreateTask}
                  />
                </div>
                <div>
                  <label className="block text-sm mb-1 required-label">
                    Assignees
                  </label>
                  <ReportingPersonMultiSelect
                    options={memberOptions}
                    value={assignees}
                    onChange={setAssignees}
                    placeholder="Select assignees"
                    emptyMessage="No team members available"
                    disabled={!canCreateTask}
                  />
                </div>
                <div>
                  <label className="block text-sm mb-1">Priority</label>
                  <Select
                    value={priority}
                    onValueChange={(v) => setPriority(v as Priority)}
                    disabled={!canCreateTask}
                  >
                    <SelectTrigger className="w-full h-10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="URGENT">Urgent</SelectItem>
                      <SelectItem value="FIRST">First Priority</SelectItem>
                      <SelectItem value="SECOND">Second Priority</SelectItem>
                      <SelectItem value="LEAST">Least Priority</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="block text-sm mb-1">
                    Estimated hours (optional)
                  </label>
                  <input
                    className="w-full h-10 rounded border border-border bg-bg px-3"
                    type="number"
                    min={0}
                    step={0.1}
                    value={estimatedHours}
                    onChange={(e) => setEstimatedHours(e.target.value)}
                    disabled={!canCreateTask}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm mb-1">Description</label>
                  <textarea
                    className="w-full rounded border border-border bg-bg px-3 py-2 min-h-24"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Optional description"
                    disabled={!canCreateTask}
                  />
                </div>
              </div>

              <div className="space-y-2 pt-2 border-t border-border">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">
                    Add subtasks (optional)
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setEditSubtasks((rows) => [...rows, makeSubRow()])
                    }
                    disabled={!canCreateTask}
                  >
                    + Add subtask
                  </Button>
                </div>
                <div className="space-y-3">
                  {editSubtasks.map((row, idx) => (
                    <div
                      key={row.id}
                      className="rounded-md border border-border bg-bg px-3 py-3 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-medium">
                          Subtask {idx + 1}
                        </div>
                        {editSubtasks.length > 1 && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-auto px-1 text-xs"
                            onClick={() => removeEditSubRow(row.id)}
                            disabled={!canCreateTask}
                          >
                            Remove
                          </Button>
                        )}
                      </div>
                      <div className="grid md:grid-cols-2 gap-3">
                        <input
                          className="h-10 w-full rounded border border-border bg-surface px-3 text-sm"
                          placeholder="Subtask title"
                          value={row.title}
                          onChange={(e) =>
                            updateEditSubRow(row.id, { title: e.target.value })
                          }
                          disabled={!canCreateTask}
                        />
                        <div className="flex items-center gap-2">
                          <input
                            className="h-10 w-full rounded border border-border bg-surface px-3 text-sm"
                            type="number"
                            min={0}
                            step={0.1}
                            placeholder="Est. hours (optional)"
                            value={row.estimatedHours}
                            onChange={(e) =>
                              updateEditSubRow(row.id, {
                                estimatedHours: e.target.value,
                              })
                            }
                            disabled={!canCreateTask}
                          />
                          <Select
                            value={row.priority}
                            onValueChange={(v) =>
                              updateEditSubRow(row.id, {
                                priority: v as Priority,
                              })
                            }
                            disabled={!canCreateTask}
                          >
                            <SelectTrigger className="h-10 w-[140px] text-sm">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="URGENT">Urgent</SelectItem>
                              <SelectItem value="FIRST">First</SelectItem>
                              <SelectItem value="SECOND">Second</SelectItem>
                              <SelectItem value="LEAST">Least</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div>
                        <ReportingPersonMultiSelect
                          options={memberOptions}
                          value={row.assignees}
                          onChange={(next) =>
                            updateEditSubRow(row.id, { assignees: next })
                          }
                          placeholder="Assign team members"
                          emptyMessage="No team members available"
                          disabled={!canCreateTask}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm mb-1 required-label">
                  Task title
                </label>
                <input
                  className="w-full h-10 rounded border border-border bg-bg px-3"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Task title"
                  disabled={!canCreateTask}
                />
              </div>
              <div>
                <label className="block text-sm mb-1 required-label">
                  Assignees
                </label>
                <ReportingPersonMultiSelect
                  options={memberOptions}
                  value={assignees}
                  onChange={setAssignees}
                  placeholder="Select assignees"
                  emptyMessage="No team members available"
                  disabled={!canCreateTask}
                />
              </div>
              <div>
                <label className="block text-sm mb-1">Priority</label>
                <Select
                  value={priority}
                  onValueChange={(v) => setPriority(v as Priority)}
                  disabled={!canCreateTask}
                >
                  <SelectTrigger className="w-full h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="URGENT">Urgent</SelectItem>
                    <SelectItem value="FIRST">First Priority</SelectItem>
                    <SelectItem value="SECOND">Second Priority</SelectItem>
                    <SelectItem value="LEAST">Least Priority</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-sm mb-1">
                  Estimated hours (optional)
                </label>
                <input
                  className="w-full h-10 rounded border border-border bg-bg px-3"
                  type="number"
                  min={0}
                  step={0.1}
                  value={estimatedHours}
                  onChange={(e) => setEstimatedHours(e.target.value)}
                  disabled={!canCreateTask}
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm mb-1">Description</label>
                <textarea
                  className="w-full rounded border border-border bg-bg px-3 py-2 min-h-24"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional description"
                  disabled={!canCreateTask}
                />
              </div>
            </div>
          )}

          {formError && (
            <div className="rounded border border-error/40 bg-error/10 px-3 py-2 text-sm text-error">
              {formError}
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button
              className="h-10"
              disabled={saving || !canCreateTask || lockMeetingEdit}
              type="submit"
            >
              {saving
                ? "Saving…"
                : isSubtaskBatch
                  ? "Save Subtasks"
                  : isEditing
                    ? "Save Changes"
                    : "Create Task"}
            </Button>
          </div>
          </fieldset>
        </form>
      )}
    </div>
  );
}
