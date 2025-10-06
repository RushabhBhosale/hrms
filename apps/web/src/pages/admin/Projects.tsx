import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { Th, Td } from "../../components/ui/Table";
import { toast } from "react-hot-toast";
import { getEmployee, hasPermission } from "../../lib/auth";
import type { PrimaryRole } from "../../lib/auth";
import { Link, useNavigate } from "react-router-dom";

import { useForm, Controller } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

type EmployeeLite = {
  id: string;
  name: string;
  email: string;
  subRoles: string[];
  primaryRole: PrimaryRole;
};

type Project = {
  _id: string;
  title: string;
  description?: string;
  techStack?: string[];
  teamLead: string;
  members: string[];
  estimatedTimeMinutes?: number;
  createdAt?: string;
  startTime?: string;
  isPersonal?: boolean;
  active?: boolean;
};

// ---------- Zod schema for the create form ----------
const dtIsValid = (s?: string) => !s || !Number.isNaN(new Date(s).getTime());

const CreateProjectSchema = z
  .object({
    title: z.string().min(3, "Min 3 chars").max(120, "Max 120 chars"),
    description: z.string().max(5000, "Max 5000 chars").optional().default(""),
    techCsv: z.string().optional().default(""),
    teamLead: z.string().min(1, "Select a team lead"),
    members: z.array(z.string()).default([]),
    estimatedHours: z.preprocess(
      (v) => (v === "" || v == null || Number.isNaN(v) ? undefined : Number(v)),
      z.number().min(0, "Must be ≥ 0").optional()
    ),
    startTime: z.string().optional().refine(dtIsValid, "Invalid date/time"),
  })
  .refine((d) => !d.members.includes(d.teamLead), {
    path: ["members"],
    message: "Team lead is already selected; remove from members",
  });

type CreateProjectValues = z.infer<typeof CreateProjectSchema>;

export default function ProjectsAdmin() {
  const nav = useNavigate();
  const u = getEmployee();
  const canManageProjects = hasPermission(u, "projects", "write");

  const [loading, setLoading] = useState(false);
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [spentByProject, setSpentByProject] = useState<Record<string, number>>(
    {}
  );

  // ----- RHF setup for create form ----
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(CreateProjectSchema),
    defaultValues: {
      title: "",
      description: "",
      techCsv: "",
      teamLead: "",
      members: [],
      estimatedHours: undefined,
      startTime: "",
    },
  });

  const teamLeadOptions = useMemo(() => {
    const priority = employees.filter((e) =>
      e.subRoles?.some((r) => r === "hr" || r === "manager")
    );
    const others = employees.filter(
      (e) => !e.subRoles?.some((r) => r === "hr" || r === "manager")
    );
    return [...priority, ...others];
  }, [employees]);

  function roleLabel(e: EmployeeLite) {
    return (
      e.subRoles?.[0] ||
      (e.primaryRole === "ADMIN"
        ? "admin"
        : e.primaryRole === "SUPERADMIN"
        ? "superadmin"
        : "employee")
    );
  }

  async function load() {
    setLoading(true);
    try {
      const [emps, projs] = await Promise.all([
        api.get("/companies/employees"),
        api.get("/projects"),
      ]);
      const projList: Project[] = projs.data.projects || [];
      setEmployees(emps.data.employees || []);
      setProjects(projList);

      const map: Record<string, number> = {};
      await Promise.all(
        projList.map(async (p) => {
          try {
            const t = await api.get(`/projects/${p._id}/time-summary`);
            map[p._id] = t.data.totalTimeSpentMinutes || 0;
          } catch {
            map[p._id] = 0;
          }
        })
      );
      setSpentByProject(map);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // ----- onSubmit for create form (uses zod-validated data) -----
  const onCreate = async (data: CreateProjectValues) => {
    if (!canManageProjects) {
      toast.error("You do not have permission to create projects");
      return;
    }
    try {
      setLoading(true);

      const techStack = (data.techCsv || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const payload: Record<string, any> = {
        title: data.title.trim(),
        description: (data.description || "").trim(),
        techStack,
        teamLead: data.teamLead,
        members: data.members,
      };

      if (typeof data.estimatedHours === "number")
        payload.estimatedTimeMinutes = Math.round(data.estimatedHours * 60);
      if (data.startTime) payload.startTime = data.startTime;

      await api.post("/projects", payload);

      reset();
      await load();
      toast.success("Project created");
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Failed to create project");
    } finally {
      setLoading(false);
    }
  };

  function minutesToHours(min: number) {
    return Math.round((min / 60) * 10) / 10;
  }

  function fmtDate(s?: string) {
    if (!s) return "-";
    const d = new Date(s);
    if (isNaN(d.getTime())) return "-";
    return d.toLocaleDateString([], {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Projects</h2>
      </div>

      {/* Create form (RHF + Zod) */}
      {canManageProjects && (
        <form
          onSubmit={handleSubmit(onCreate)}
          className="space-y-4 bg-surface border border-border rounded-md p-4"
        >
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm mb-1 required-label">Title</label>
            <input
              className="w-full h-10 rounded border border-border bg-bg px-3"
              placeholder="Project title"
              {...register("title")}
            />
            {errors.title && (
              <p className="text-xs text-error mt-1">{errors.title.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm mb-1">Tech Stack</label>
            <input
              className="w-full h-10 rounded border border-border bg-bg px-3"
              placeholder="e.g. React, Node, MongoDB"
              {...register("techCsv")}
            />
          </div>

          <div>
            <label className="block text-sm mb-1">Estimated Time (hours)</label>
            <input
              className="w-full h-10 rounded border border-border bg-bg px-3"
              type="number"
              min={0}
              step={0.1}
              placeholder="e.g. 120"
              {...register("estimatedHours", { valueAsNumber: true })}
            />
            {errors.estimatedHours && (
              <p className="text-xs text-error mt-1">
                {errors.estimatedHours.message as string}
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm mb-1">Start Time</label>
            <input
              className="w-full h-10 rounded border border-border bg-bg px-3"
              type="datetime-local"
              {...register("startTime")}
            />
            {errors.startTime && (
              <p className="text-xs text-error mt-1">
                {errors.startTime.message as string}
              </p>
            )}
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm mb-1">Description</label>
            <textarea
              className="w-full rounded border border-border bg-bg px-3 py-2 min-h-20"
              placeholder="Optional description"
              {...register("description")}
            />
            {errors.description && (
              <p className="text-xs text-error mt-1">
                {errors.description.message}
              </p>
            )}
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm mb-1 required-label">
              Team Lead
            </label>
            <select
              className="w-full h-10 rounded border border-border bg-bg px-3"
              {...register("teamLead")}
            >
              <option value="">Select team lead</option>
              {teamLeadOptions.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} ({roleLabel(e)})
                </option>
              ))}
            </select>
            {errors.teamLead && (
              <p className="text-xs text-error mt-1">
                {errors.teamLead.message}
              </p>
            )}
          </div>

          {/* Members multi-select dropdown */}
          <div>
            <label className="block text-sm mb-1">Members</label>
            <Controller
              control={control}
              name="members"
              render={({ field }) => (
                <select
                  multiple
                  className="w-full rounded border border-border bg-bg p-2 min-h-[140px]"
                  value={field.value}
                  onChange={(ev) => {
                    const vals = Array.from(
                      ev.currentTarget.selectedOptions
                    ).map((o) => o.value);
                    field.onChange(vals);
                  }}
                >
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name} ({roleLabel(e)})
                    </option>
                  ))}
                </select>
              )}
            />
            <p className="text-xs text-muted mt-1">
              Tip: Hold Ctrl/Cmd to select multiple.
            </p>
            {errors.members && (
              <p className="text-xs text-error mt-1">
                {errors.members.message as string}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            className="inline-flex items-center justify-center h-10 px-4 rounded-md bg-primary text-white disabled:opacity-50"
            disabled={isSubmitting || loading}
          >
            {isSubmitting || loading ? "Creating…" : "Create Project"}
          </button>
        </div>
        </form>
      )}

      {/* List as table */}
      <div className="overflow-auto border border-border rounded-md bg-surface">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-bg border-b border-border">
              <Th>Project</Th>
              <Th>Team Lead</Th>
              <Th>Members</Th>
              <Th>Start</Th>
              <Th>Est (h)</Th>
              <Th>Spent (h)</Th>
              <Th>Budget</Th>
              <Th>Active</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => {
              const est = p.estimatedTimeMinutes || 0;
              const spent = spentByProject[p._id] || 0;
              const over = spent - est;
              return (
                <tr key={p._id} className="border-b border-border">
                  <Td>
                    <div className="font-medium">{p.title}</div>
                    {p.description && (
                      <div
                        className="text-xs text-muted truncate max-w-[360px]"
                        title={p.description}
                      >
                        {p.description}
                      </div>
                    )}
                  </Td>
                  <Td>
                    {employees.find((e) => e.id === p.teamLead)?.name || "—"}
                  </Td>
                  <Td>{p.members?.length || 0}</Td>
                  <Td>{fmtDate(p.startTime || p.createdAt)}</Td>
                  <Td>{minutesToHours(est)}</Td>
                  <Td>{minutesToHours(spent)}</Td>
                  <Td>
                    {over > 0 ? (
                      <span className="text-error">
                        + {minutesToHours(over)} h
                      </span>
                    ) : (
                      <span className="text-muted">
                        - {minutesToHours(Math.max(0, est - spent))} h
                      </span>
                    )}
                  </Td>
                  <Td>
                    {p.isPersonal ? (
                      <span className="text-xs text-muted">Personal</span>
                    ) : (
                      <span
                        className={`text-xs px-2 py-0.5 rounded border ${
                          p.active !== false
                            ? "border-secondary/30 text-secondary bg-secondary/10"
                            : "border-muted/40 text-muted"
                        }`}
                      >
                        {p.active !== false ? "Active" : "Inactive"}
                      </span>
                    )}
                  </Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      <Link
                        to={`/admin/projects/${p._id}`}
                        className="h-8 px-3 rounded-md border border-border hover:bg-bg inline-flex items-center"
                      >
                        Open
                      </Link>
                      {!p.isPersonal && (
                        <button
                          onClick={async () => {
                            try {
                              const resp = await api.put(`/projects/${p._id}`, {
                                active: !p.active,
                              });
                              const next = resp.data.project?.active;
                              setProjects((list) =>
                                list.map((x) =>
                                  x._id === p._id ? { ...x, active: next } : x
                                )
                              );
                            } catch (e: any) {
                              toast.error(
                                e?.response?.data?.error ||
                                  "Failed to update project"
                              );
                            }
                          }}
                          className="h-8 px-3 rounded-md border border-border hover:bg-bg inline-flex items-center"
                          title={
                            p.active !== false ? "Mark Inactive" : "Mark Active"
                          }
                        >
                          {p.active !== false ? "Deactivate" : "Activate"}
                        </button>
                      )}
                    </div>
                  </Td>
                </tr>
              );
            })}
            {projects.length === 0 && (
              <tr>
                <td className="px-3 py-3 text-sm text-muted" colSpan={9}>
                  No projects yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
