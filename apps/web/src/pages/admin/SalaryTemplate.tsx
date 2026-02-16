"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { api } from "../../lib/api";
import { GripVertical } from "lucide-react";

type FieldType = "text" | "number" | "date";
type FieldCategory = "earning" | "deduction" | "info";
type Field = {
  id: string;
  key: string;
  label: string;
  type: FieldType;
  defaultValue?: any;
  order?: number;
  category?: FieldCategory;
  autoKey?: boolean;
  amountType?: "fixed" | "percent";
  locked?: boolean;
};

type Settings = {
  basicPercent: number;
  hraPercent: number;
  medicalAmount: number;
};

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}
function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const PROTECTED_KEYS = new Set([
  "basic_earned",
  "hra",
  "medical",
  "other_allowances",
]);

const FieldTypeEnum = z.enum(["text", "number", "date"]);
const FieldCategoryEnum = z.enum(["earning", "deduction", "info"]);

const BasicFieldSchema = z.object({
  id: z.string().min(1),
  key: z
    .string()
    .min(1, "Key required")
    .regex(/^[a-z0-9_]+$/, "Use a-z, 0-9, _"),
  label: z.string().min(1, "Label required"),
  type: FieldTypeEnum,
  defaultValue: z.any().optional(),
  order: z.number().int().nonnegative().optional(),
  category: FieldCategoryEnum.optional(),
  autoKey: z.boolean().optional(),
  amountType: z.union([z.literal("fixed"), z.literal("percent")]).optional(),
  locked: z.boolean().optional(),
});

const BasicSettingsSchema = z.object({
  basicPercent: z.number().finite().min(0),
  hraPercent: z.number().finite().min(0),
  medicalAmount: z.number().finite().min(0),
});

const BasicTemplateSchema = z
  .object({
    fields: z.array(BasicFieldSchema),
    settings: BasicSettingsSchema,
  })
  .superRefine((tpl, ctx) => {
    const seen = new Map<string, number[]>();
    tpl.fields.forEach((f, i) => {
      const k = (f.key || "").trim();
      if (!k) return;
      const arr = seen.get(k) || [];
      arr.push(i);
      seen.set(k, arr);
    });
    for (const [k, idxs] of seen.entries()) {
      if (idxs.length > 1) {
        idxs.forEach((i) =>
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Duplicate key: ${k}`,
            path: ["fields", i, "key"],
          }),
        );
      }
    }
  });

export default function SalaryTemplate() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [fields, setFields] = useState<Field[]>([]);
  const [settings, setSettings] = useState<Settings>({
    basicPercent: 35,
    hraPercent: 45,
    medicalAmount: 1500,
  });

  const [q, setQ] = useState("");
  const [cat, setCat] = useState<"all" | FieldCategory>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | FieldType>("all");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const [zodErrors, setZodErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setErr(null);

        const res = await api.get("/salary/templates");
        const rawFields = (res.data.template?.fields || []) as any[];
        const s = (res.data.template?.settings || {}) as Partial<Settings>;

        let normalized: Field[] = rawFields
          .map((fld: any, i: number) => {
            const key = fld.key || slugify(fld.label || "");
            const isProtected = PROTECTED_KEYS.has(key) || !!fld.locked;
            return {
              id: fld.id || uid(),
              key,
              label: fld.label || "",
              type: (fld.type as FieldType) || "text",
              defaultValue: fld.defaultValue ?? "",
              category: (fld.category as FieldCategory) || "info",
              order: Number.isFinite(fld.order) ? fld.order : i,
              autoKey: !fld.key || fld.key === slugify(fld.label),
              amountType:
                (fld.amountType as "fixed" | "percent") ||
                (fld.type === "number" ? "fixed" : undefined),
              locked: isProtected,
            } as Field;
          })
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

        for (const f of normalized) {
          if (f.key === "basic_earned") {
            const v = Number.isFinite(Number(s.basicPercent))
              ? Number(s.basicPercent)
              : undefined;
            if (v !== undefined) f.defaultValue = v;
            else if (f.defaultValue == null) f.defaultValue = 0;
            f.type = "number";
            f.amountType = "percent";
          } else if (f.key === "hra") {
            const v = Number.isFinite(Number(s.hraPercent))
              ? Number(s.hraPercent)
              : undefined;
            if (v !== undefined) f.defaultValue = v;
            else if (f.defaultValue == null) f.defaultValue = 0;
            f.type = "number";
            f.amountType = "percent";
          } else if (f.key === "medical") {
            const v = Number.isFinite(Number(s.medicalAmount))
              ? Number(s.medicalAmount)
              : undefined;
            if (v !== undefined) f.defaultValue = v;
            else if (f.defaultValue == null) f.defaultValue = 0;
            f.type = "number";
            f.amountType = "fixed";
          } else if (f.key === "other_allowances") {
            if (f.defaultValue == null) f.defaultValue = 0;
            f.type = "number";
            f.amountType = "fixed";
          }
        }

        const nextSettings: Settings = {
          basicPercent: Number.isFinite(Number(s.basicPercent))
            ? Number(s.basicPercent)
            : Number(
                normalized.find((x) => x.key === "basic_earned")?.defaultValue,
              ) || 0,
          hraPercent: Number.isFinite(Number(s.hraPercent))
            ? Number(s.hraPercent)
            : Number(normalized.find((x) => x.key === "hra")?.defaultValue) ||
              0,
          medicalAmount: Number.isFinite(Number(s.medicalAmount))
            ? Number(s.medicalAmount)
            : Number(
                normalized.find((x) => x.key === "medical")?.defaultValue,
              ) || 0,
        };

        const parsed = BasicTemplateSchema.safeParse({
          fields: normalized,
          settings: nextSettings,
        });
        if (!parsed.success) {
          const e: Record<string, string> = {};
          parsed.error.issues.forEach((iss) => {
            e[iss.path.join(".")] = iss.message;
          });
          setZodErrors(e);
          setErr("Loaded with basic validation warnings");
        } else {
          setZodErrors({});
        }

        setSettings(nextSettings);
        setFields(normalized);
      } catch (e: any) {
        setErr(e?.response?.data?.error || "Failed to load template");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const counts = useMemo(() => {
    const c = { total: fields.length, earning: 0, deduction: 0, info: 0 };
    for (const f of fields) c[(f.category as FieldCategory) || "info"]++;
    return c;
  }, [fields]);

  const { hasDuplicateKeys, invalids, duplicateSet } = useMemo(() => {
    const map = new Map<string, number>();
    const invalidIdx: number[] = [];
    fields.forEach((f, i) => {
      const k = (f.key || "").trim();
      if (k) map.set(k, (map.get(k) || 0) + 1);
      if (!f.label.trim() || !k) invalidIdx.push(i);
    });
    const dupes = new Set(
      [...map.entries()].filter(([, c]) => c > 1).map(([k]) => k),
    );
    return {
      hasDuplicateKeys: dupes.size > 0,
      invalids: new Set(invalidIdx),
      duplicateSet: dupes,
    };
  }, [fields]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return fields.filter((f) => {
      if (cat !== "all" && (f.category || "info") !== cat) return false;
      if (typeFilter !== "all" && f.type !== typeFilter) return false;
      if (!qq) return true;
      return (
        f.label.toLowerCase().includes(qq) ||
        (f.key || "").toLowerCase().includes(qq)
      );
    });
  }, [fields, q, cat, typeFilter]);

  function validateBasic(fs: Field[], s: Settings) {
    const parsed = BasicTemplateSchema.safeParse({ fields: fs, settings: s });
    if (!parsed.success) {
      const e: Record<string, string> = {};
      parsed.error.issues.forEach(
        (iss) => (e[iss.path.join(".")] = iss.message),
      );
      setZodErrors(e);
      return false;
    }
    setZodErrors({});
    return true;
  }

  const save = useCallback(async () => {
    try {
      setErr(null);
      setOk(null);

      const basic = fields.find((x) => x.key === "basic_earned");
      const hra = fields.find((x) => x.key === "hra");
      const med = fields.find((x) => x.key === "medical");

      const nextSettings: Settings = {
        basicPercent: Number(basic?.defaultValue ?? settings.basicPercent ?? 0),
        hraPercent: Number(hra?.defaultValue ?? settings.hraPercent ?? 0),
        medicalAmount: Number(med?.defaultValue ?? settings.medicalAmount ?? 0),
      };

      const fs = fields.map((f, i) => ({ ...f, order: i }));
      if (!validateBasic(fs, nextSettings)) {
        setErr("Fix basic validation errors");
        return;
      }

      await api.post("/salary/templates", {
        fields: fs,
        settings: nextSettings,
      });
      setSettings(nextSettings);
      setOk("Saved");
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to save template");
    }
  }, [fields, settings]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey as any);
    return () => window.removeEventListener("keydown", onKey as any);
  }, [save]);

  function addField() {
    setFields((prev) => [
      ...prev,
      {
        id: uid(),
        key: "",
        label: "",
        type: "text",
        defaultValue: "",
        category: "info",
        autoKey: true,
        order: prev.length,
        amountType: "fixed",
      },
    ]);
  }

  function updateField(i: number, patch: Partial<Field>) {
    setFields((prev) =>
      prev.map((f, idx) => {
        if (idx !== i) return f;
        const isProtected = f.locked || PROTECTED_KEYS.has(f.key);
        if (isProtected) {
          const allowed: Partial<Field> = {};
          if ("defaultValue" in patch)
            allowed.defaultValue = patch.defaultValue;
          return { ...f, ...allowed, locked: true };
        }
        const next = { ...f, ...patch };
        if (next.autoKey && "label" in patch)
          next.key = slugify(next.label || "");
        if ("key" in patch) next.key = slugify(String(patch.key || ""));
        return next;
      }),
    );
  }

  const pct = (v: any) => {
    const n = Number(v);
    return Number.isFinite(n) ? `${n}%` : "—%";
  };

  function removeField(i: number) {
    setFields((prev) => {
      const f = prev[i];
      if (f.locked || PROTECTED_KEYS.has(f.key)) return prev;
      return prev.filter((_, idx) => idx !== i);
    });
  }

  const isLockedField = useCallback(
    (field?: Field | null) =>
      !!(field && (field.locked || PROTECTED_KEYS.has(field.key))),
    [],
  );

  const reorderFields = useCallback(
    (sourceId: string, targetId: string) => {
      if (!sourceId || !targetId || sourceId === targetId) return;
      setFields((prev) => {
        const next = [...prev];
        const fromIdx = next.findIndex((f) => f.id === sourceId);
        const toIdx = next.findIndex((f) => f.id === targetId);
        if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return prev;
        const source = next[fromIdx];
        const target = next[toIdx];
        if (isLockedField(source) || isLockedField(target)) return prev;
        const [moved] = next.splice(fromIdx, 1);
        next.splice(toIdx, 0, moved);
        return next.map((f, idx) => ({ ...f, order: idx }));
      });
    },
    [isLockedField],
  );

  useEffect(() => {
    const fs = fields.map((f, i) => ({ ...f, order: i }));
    validateBasic(fs, settings);
  }, [fields, settings]);

  function unitForField(f: Field): {
    unitLabel: string;
    prefix?: string;
    suffix?: string;
  } {
    if (
      f.key === "basic_earned" ||
      f.key === "hra" ||
      f.amountType === "percent"
    )
      return { unitLabel: "%", suffix: "%" };
    if (
      f.key === "medical" ||
      f.key === "other_allowances" ||
      f.amountType === "fixed"
    )
      return { unitLabel: "₹", prefix: "₹" };
    return { unitLabel: "" };
  }

  if (loading) return <div>Loading…</div>;

  return (
    <div className="mx-auto w-full max-w-screen-lg space-y-3 px-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">Salary Template</h2>
        <span className="rounded-full border border-border px-2 py-0.5 text-xs">
          {counts.total} • {counts.earning} earning • {counts.deduction}{" "}
          deduction • {counts.info} info
        </span>
        <span className="text-xs text-muted-foreground">
          Drag the handle to reorder fields
        </span>
        <div className="ml-auto flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            className="h-9 w-full rounded-md border border-border bg-bg px-3 text-sm sm:w-60"
          />
          <select
            className="h-9 rounded-md border border-border bg-bg px-2 text-sm"
            value={cat}
            onChange={(e) => setCat(e.target.value as any)}
          >
            <option value="all">All</option>
            <option value="info">Info</option>
            <option value="earning">Earning</option>
            <option value="deduction">Deduction</option>
          </select>
          <select
            className="h-9 rounded-md border border-border bg-bg px-2 text-sm"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as any)}
          >
            <option value="all">Any Type</option>
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="date">Date</option>
          </select>
        </div>
      </div>

      <div className="rounded-md border border-border bg-surface p-2">
        <div className="max-h-[70vh] overflow-auto pr-1">
          {filtered.length === 0 && (
            <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No fields match.
            </div>
          )}

          <div className="grid grid-cols-1 gap-2">
            {filtered.map((f, iFiltered) => {
              const i = fields.indexOf(f);
              const isDup = f.key && duplicateSet.has(f.key);
              const isInvalid = !f.label.trim() || !(f.key || "").trim();
              const isProtected = f.locked || PROTECTED_KEYS.has(f.key);
              const disableKeyLabel = !!isProtected;

              const keyErr = zodErrors[`fields.${i}.key`];
              const labelErr = zodErrors[`fields.${i}.label`];

              const { unitLabel, prefix, suffix } = unitForField(f);
              const valueLabel = `Value${unitLabel ? ` (${unitLabel})` : ""}`;
              const isDragOver = dragOverId === f.id;
              const isDragging = draggingId === f.id;

              return (
                <div
                  key={f.id}
                  className={`rounded border ${
                    isInvalid ? "border-amber-600" : "border-border"
                  } bg-white p-2 ${
                    isDragOver ? "ring-2 ring-primary/40" : ""
                  } ${isDragging ? "opacity-80" : ""}`}
                  onDragOver={(e) => {
                    if (!draggingId || isProtected) return;
                    const draggedField = fields.find(
                      (fld) => fld.id === draggingId,
                    );
                    if (!draggedField || isLockedField(draggedField)) return;
                    e.preventDefault();
                    setDragOverId(f.id);
                  }}
                  onDragEnter={(e) => {
                    if (!draggingId || isProtected) return;
                    const draggedField = fields.find(
                      (fld) => fld.id === draggingId,
                    );
                    if (!draggedField || isLockedField(draggedField)) return;
                    e.preventDefault();
                    setDragOverId(f.id);
                  }}
                  onDragLeave={() => {
                    if (dragOverId === f.id) setDragOverId(null);
                  }}
                  onDrop={(e) => {
                    if (!draggingId || isProtected) return;
                    e.preventDefault();
                    reorderFields(draggingId, f.id);
                    setDragOverId(null);
                    setDraggingId(null);
                  }}
                >
                  <div className="mb-1 flex items-center gap-2">
                    <button
                      type="button"
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded border text-lg leading-none ${
                        isProtected
                          ? "cursor-not-allowed border-border/70 bg-slate-100 text-muted-foreground"
                          : "cursor-grab border-border bg-slate-50 text-slate-600 hover:border-slate-400"
                      }`}
                      title={
                        isProtected
                          ? "System field order is locked"
                          : "Drag to reorder"
                      }
                      draggable={!isProtected}
                      onDragStart={(e) => {
                        if (isProtected) return;
                        setDraggingId(f.id);
                        setDragOverId(null);
                        try {
                          e.dataTransfer?.setData("text/plain", f.id);
                        } catch (_) {
                          // ignore
                        }
                        if (e.dataTransfer)
                          e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => {
                        setDraggingId(null);
                        setDragOverId(null);
                      }}
                      aria-label="Drag to reorder"
                    >
                      <GripVertical className="size-4" />
                    </button>
                    <span
                      className={`rounded px-2 py-0.5 text-[10px] ${
                        (f.category || "info") === "earning"
                          ? "bg-emerald-100 text-emerald-800"
                          : (f.category || "info") === "deduction"
                            ? "bg-rose-100 text-rose-800"
                            : "bg-slate-100 text-slate-800"
                      }`}
                    >
                      {f.category || "info"}
                    </span>
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] text-slate-800">
                      {f.type}
                    </span>
                    {isProtected && (
                      <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] text-amber-800">
                        system
                      </span>
                    )}
                    <div className="ml-auto">
                      {!isProtected && (
                        <button
                          className="text-xs text-error underline"
                          onClick={() => removeField(i)}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
                    <div>
                      <div className="mb-0.5 text-[10px] text-muted-foreground">
                        Label
                      </div>
                      <input
                        value={f.label}
                        onChange={(e) =>
                          updateField(i, {
                            label: e.target.value,
                            ...(f.autoKey
                              ? { key: slugify(e.target.value) }
                              : {}),
                          })
                        }
                        disabled={disableKeyLabel}
                        className={`h-9 w-full rounded border px-2 text-sm ${
                          labelErr ? "border-error" : "border-border"
                        } bg-bg disabled:opacity-60`}
                        placeholder="Basic Earned"
                      />
                      {labelErr && (
                        <div className="mt-1 text-[10px] text-error">
                          {labelErr}
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="mb-0.5 flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>Key</span>
                        <label className="inline-flex items-center gap-1 text-[10px]">
                          <input
                            type="checkbox"
                            checked={!!f.autoKey}
                            onChange={(e) =>
                              updateField(i, { autoKey: e.target.checked })
                            }
                            disabled={disableKeyLabel}
                          />
                          Auto
                        </label>
                      </div>
                      <input
                        value={f.key}
                        onChange={(e) =>
                          updateField(i, { key: slugify(e.target.value) })
                        }
                        disabled={disableKeyLabel || !!f.autoKey}
                        className={`h-9 w-full rounded border px-2 text-sm ${
                          isDup || keyErr ? "border-error" : "border-border"
                        } bg-bg disabled:opacity-60`}
                        placeholder="basic_earned"
                      />
                      {(isDup || keyErr) && (
                        <div className="mt-1 text-[10px] text-error">
                          {keyErr || "Duplicate key"}
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <div className="mb-0.5 text-[10px] text-muted-foreground">
                          Type
                        </div>
                        <select
                          value={f.type}
                          onChange={(e) =>
                            updateField(i, {
                              type: e.target.value as FieldType,
                              defaultValue: "",
                            })
                          }
                          disabled={isProtected}
                          className="h-9 w-full rounded border border-border bg-bg px-2 text-sm disabled:opacity-60"
                        >
                          <option value="text">Text</option>
                          <option value="number">Number</option>
                          <option value="date">Date</option>
                        </select>
                      </div>
                      <div>
                        <div className="mb-0.5 text-[10px] text-muted-foreground">
                          Category
                        </div>
                        <select
                          value={f.category || "info"}
                          onChange={(e) =>
                            updateField(i, {
                              category: e.target.value as FieldCategory,
                            })
                          }
                          disabled={isProtected}
                          className="h-9 w-full rounded border border-border bg-bg px-2 text-sm disabled:opacity-60"
                        >
                          <option value="info">Info</option>
                          <option value="earning">Earning</option>
                          <option value="deduction">Deduction</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <div className="mb-0.5 text-[10px] text-muted-foreground">
                        {valueLabel}
                      </div>
                      <div className="flex items-stretch gap-1">
                        {prefix && (
                          <span className="inline-flex h-9 select-none items-center rounded border border-border bg-slate-50 px-2 text-sm text-slate-700">
                            {prefix}
                          </span>
                        )}
                        <input
                          type={
                            f.type === "number"
                              ? "number"
                              : f.type === "date"
                                ? "date"
                                : "text"
                          }
                          value={f.defaultValue ?? ""}
                          onChange={(e) =>
                            updateField(i, {
                              defaultValue:
                                f.type === "number"
                                  ? e.target.value === ""
                                    ? ""
                                    : Number(e.target.value)
                                  : e.target.value,
                            })
                          }
                          className="h-9 w-full rounded border border-border bg-bg px-2 text-sm"
                        />
                        {suffix && (
                          <span className="inline-flex h-9 select-none items-center rounded border border-border bg-slate-50 px-2 text-sm text-slate-700">
                            {suffix}
                          </span>
                        )}
                      </div>

                      {f.type === "number" && !isProtected && (
                        <div className="mt-1 grid grid-cols-2 gap-2">
                          <select
                            value={f.amountType || "fixed"}
                            onChange={(e) =>
                              updateField(i, {
                                amountType: e.target.value as
                                  | "fixed"
                                  | "percent",
                              })
                            }
                            className="h-8 w-full rounded border border-border bg-bg px-2 text-xs"
                          >
                            <option value="fixed">Fixed</option>
                            <option value="percent">Percent</option>
                          </select>
                          <span className="self-center text-[10px] text-muted-foreground">
                            {f.amountType === "percent"
                              ? "Interpreted as %"
                              : "Fixed amount"}
                          </span>
                        </div>
                      )}

                      {f.type === "number" &&
                        isProtected &&
                        (f.key === "basic_earned" || f.key === "hra") && (
                          <div className="mt-1 text-[10px] text-slate-700">
                            {f.key === "basic_earned" ? (
                              <>
                                Basic: <strong>{pct(f.defaultValue)}</strong> of
                                total
                              </>
                            ) : (
                              <>
                                HRA: <strong>{pct(f.defaultValue)}</strong> of
                                basic
                              </>
                            )}
                          </div>
                        )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="sticky bottom-0 left-0 right-0 z-10 border-t border-border bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
        <div className="mx-auto flex max-w-screen-lg items-center gap-2 px-3 py-2">
          {err && <div className="text-xs text-error">{err}</div>}
          {ok && <div className="text-xs text-success">{ok}</div>}
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={addField}
              className="h-9 rounded border border-border bg-bg px-3 text-sm"
            >
              Add Field
            </button>
            <button
              onClick={save}
              disabled={
                hasDuplicateKeys ||
                invalids.size > 0 ||
                Object.keys(zodErrors).length > 0
              }
              className="h-9 rounded bg-primary px-4 text-sm text-white disabled:opacity-50"
              title={
                hasDuplicateKeys
                  ? "Duplicate keys"
                  : invalids.size
                    ? "Fix empty label/key"
                    : Object.keys(zodErrors).length
                      ? "Fix validation errors"
                      : undefined
              }
            >
              Save
            </button>
          </div>
        </div>
      </div>

      {(hasDuplicateKeys ||
        invalids.size > 0 ||
        Object.keys(zodErrors).length > 0) && (
        <div className="text-sm text-amber-600">
          {hasDuplicateKeys ? "Duplicate keys. " : ""}
          {invalids.size ? `${invalids.size} field(s) need label/key. ` : ""}
          {Object.keys(zodErrors).length ? "Validation errors present." : ""}
        </div>
      )}
    </div>
  );
}
