import { useEffect, useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";

import { api } from "../../lib/api";
import { getEmployee, hasPermission } from "../../lib/auth";
import type { PrimaryRole } from "../../lib/auth";
import ReportingPersonMultiSelect from "../../components/ReportingPersonMultiSelect";
import { BackButton } from "../../components/utils/BackButton";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover";
import { Calendar } from "../../components/ui/calendar";
import { Calendar as CalendarIcon } from "lucide-react";
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
type ClientLite = {
  _id: string;
  name: string;
  email?: string;
};

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
      z.number().min(0, "Must be ≥ 0").optional(),
    ),
    monthlyEstimateHours: z.preprocess(
      (v) => (v === "" || v == null || Number.isNaN(v) ? undefined : Number(v)),
      z.number().min(0, "Must be ≥ 0").optional(),
    ),
    startTime: z.string().optional().refine(dtIsValid, "Invalid date"),
    clientId: z.preprocess(
      (v) => (v === "" || v === "__none" || v == null ? undefined : v),
      z.string().optional(),
    ),
  })
  .refine((d) => !d.members.includes(d.teamLead), {
    path: ["members"],
    message: "Team lead is already selected; remove from members",
  });

type CreateProjectValues = z.infer<typeof CreateProjectSchema>;
type CreateProjectInput = z.input<typeof CreateProjectSchema>;

export default function CreateProject() {
  const navigate = useNavigate();
  const location = useLocation();
  const viewer = getEmployee();
  const canCreate = hasPermission(viewer, "projects", "write");
  const listPath = location.pathname.startsWith("/admin")
    ? "/admin/projects"
    : "/app/projects";

  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(true);
  const [clients, setClients] = useState<ClientLite[]>([]);
  const [loadingClients, setLoadingClients] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateProjectInput, any, CreateProjectValues>({
    resolver: zodResolver(CreateProjectSchema),
    defaultValues: {
      title: "",
      description: "",
      techCsv: "",
      teamLead: "",
      members: [],
      estimatedHours: undefined,
      monthlyEstimateHours: undefined,
      startTime: "",
      clientId: undefined,
    },
  });

  useEffect(() => {
    async function loadEmployees() {
      setLoadingEmployees(true);
      try {
        const resp = await api.get("/companies/employees");
        setEmployees(resp.data.employees || []);
      } catch (e: any) {
        toast.error(e?.response?.data?.error || "Failed to load employees");
      } finally {
        setLoadingEmployees(false);
      }
    }
    loadEmployees();
  }, []);

  useEffect(() => {
    async function loadClients() {
      setLoadingClients(true);
      try {
        const resp = await api.get("/clients");
        setClients(resp.data.clients || []);
      } catch (e: any) {
        toast.error(e?.response?.data?.error || "Failed to load clients");
      } finally {
        setLoadingClients(false);
      }
    }
    loadClients();
  }, []);

  const teamLeadOptions = useMemo(() => {
    const priority = employees.filter((e) =>
      e.subRoles?.some((r) => r === "hr" || r === "manager"),
    );
    const others = employees.filter(
      (e) => !e.subRoles?.some((r) => r === "hr" || r === "manager"),
    );
    return [...priority, ...others];
  }, [employees]);

  const memberOptions = useMemo(
    () =>
      employees.map((e) => ({
        value: e.id,
        label: `${e.name} (${roleLabel(e)})`,
      })),
    [employees],
  );

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

  const onSubmit = async (data: CreateProjectValues) => {
    if (!canCreate) {
      toast.error("You do not have permission to create projects");
      return;
    }
    try {
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

      if (typeof data.estimatedHours === "number") {
        payload.estimatedTimeMinutes = Math.round(data.estimatedHours * 60);
      }
      if (typeof data.monthlyEstimateHours === "number") {
        payload.monthlyEstimateMinutes = Math.round(
          data.monthlyEstimateHours * 60,
        );
      }
      if (data.startTime) {
        const d = new Date(data.startTime);
        if (!Number.isNaN(d.getTime())) {
          d.setHours(0, 0, 0, 0);
          payload.startTime = d.toISOString();
        }
      }
      if (data.clientId) payload.client = data.clientId;

      await api.post("/projects", payload);
      toast.success("Project created");
      reset();
      navigate(listPath, { replace: true });
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Failed to create project");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            Create Project
          </h2>
          <p className="text-sm text-muted-foreground">
            Fill in project details and assign the core team.
          </p>
        </div>
        <BackButton to={listPath} label="Back to Projects" />
      </div>

      {!canCreate ? (
        <div className="rounded-md border border-error/30 bg-error/5 px-4 py-3 text-sm text-error">
          You do not have permission to create a project.
        </div>
      ) : (
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="space-y-4 bg-surface border border-border rounded-md p-4"
        >
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm mb-1 required-label">Title</label>
              <Input placeholder="Project title" {...register("title")} />
              {errors.title && (
                <p className="text-xs text-error mt-1">
                  {errors.title.message}
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm mb-1">Tech Stack</label>
              <Input
                placeholder="e.g. React, Node, MongoDB"
                {...register("techCsv")}
              />
            </div>

            <div>
              <label className="block text-sm mb-1">
                Estimated Time (hours)
              </label>
              <Input
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
              <label className="block text-sm mb-1">
                Monthly Estimate (hours per month)
              </label>
              <Input
                type="number"
                min={0}
                step={0.1}
                placeholder="e.g. 90"
                {...register("monthlyEstimateHours", { valueAsNumber: true })}
              />
              {errors.monthlyEstimateHours && (
                <p className="text-xs text-error mt-1">
                  {errors.monthlyEstimateHours.message as string}
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm mb-1">Start Date</label>
              <Controller
                control={control}
                name="startTime"
                render={({ field }) => {
                  const value = field.value ? new Date(field.value) : undefined;
                  return (
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full justify-start text-left font-normal"
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {value
                            ? value.toLocaleDateString("en-GB")
                            : "Pick a date"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="p-0">
                        <Calendar
                          mode="single"
                          selected={value}
                          onSelect={(day) => {
                            if (!day) {
                              field.onChange(undefined);
                            } else {
                              const d = new Date(day);
                              d.setHours(0, 0, 0, 0);
                              field.onChange(d.toISOString());
                            }
                          }}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                  );
                }}
              />
              {errors.startTime && (
                <p className="text-xs text-error mt-1">
                  {errors.startTime.message as string}
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm mb-1">Client (optional)</label>
              <Controller
                control={control}
                name="clientId"
                render={({ field }) => (
                  <Select
                    value={
                      typeof field.value === "string" ? field.value : "__none"
                    }
                    onValueChange={(val) =>
                      field.onChange(val === "__none" ? undefined : val)
                    }
                    disabled={loadingClients}
                  >
                    <SelectTrigger className="w-full h-10">
                      <SelectValue placeholder="No client" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">No client</SelectItem>
                      {clients.map((c) => (
                        <SelectItem key={c._id} value={c._id}>
                          {c.name} {c.email ? `(${c.email})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
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
              <Controller
                control={control}
                name="teamLead"
                render={({ field }) => (
                  <Select
                    value={field.value || undefined}
                    onValueChange={field.onChange}
                    disabled={loadingEmployees}
                  >
                    <SelectTrigger className="w-full h-10">
                      <SelectValue placeholder="Select team lead" />
                    </SelectTrigger>
                    <SelectContent>
                      {teamLeadOptions.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.name} ({roleLabel(e)})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.teamLead && (
                <p className="text-xs text-error mt-1">
                  {errors.teamLead.message}
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm mb-1">Members</label>
              <Controller
                control={control}
                name="members"
                render={({ field }) => (
                  <ReportingPersonMultiSelect
                    options={memberOptions}
                    value={field.value || []}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    disabled={loadingEmployees}
                    placeholder="Search and add team members"
                    emptyMessage="No employees available"
                  />
                )}
              />
              {errors.members && (
                <p className="text-xs text-error mt-1">
                  {errors.members.message as string}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              className="h-10"
              disabled={isSubmitting || loadingEmployees}
              type="submit"
            >
              {isSubmitting ? "Creating…" : "Create Project"}
            </Button>
            <span className="text-xs text-muted-foreground">
              {loadingEmployees && "Loading employees…"}
            </span>
          </div>
        </form>
      )}
    </div>
  );
}
