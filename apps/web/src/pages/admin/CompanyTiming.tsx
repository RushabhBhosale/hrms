import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { toast } from "react-hot-toast";
import { Field } from "../../components/utils/Field";
import {
  useForm,
  type SubmitHandler,
  type UseFormReturn,
} from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

const schema = z
  .object({
    start: z.string().regex(timeRegex, "Invalid time (HH:mm)"),
    end: z.string().regex(timeRegex, "Invalid time (HH:mm)"),
    graceMinutes: z.coerce
      .number()
      .int("Must be a whole number")
      .min(0, "Cannot be negative")
      .max(240, "Too large (max 240)"),
    minFullDayHours: z.coerce
      .number()
      .gt(0, "Must be greater than zero")
      .max(24, "Too large (max 24)"),
    minHalfDayHours: z.coerce
      .number()
      .min(0, "Cannot be negative")
      .max(24, "Too large (max 24)"),
  })
  .refine((v) => toMin(v.end) > toMin(v.start), {
    path: ["end"],
    message: "End must be after start",
  })
  .refine((v) => v.minHalfDayHours <= v.minFullDayHours, {
    path: ["minHalfDayHours"],
    message: "Half day hours cannot exceed full day hours",
  });

type FormValues = z.infer<typeof schema>;

export default function CompanyTiming() {
  const [loading, setLoading] = useState(true);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      start: "09:30",
      end: "18:30",
      graceMinutes: 0,
      minFullDayHours: 6,
      minHalfDayHours: 3,
    },
    mode: "onSubmit",
    reValidateMode: "onChange",
    shouldFocusError: true,
  });

  const {
    register,
    reset,
    handleSubmit,
    formState: { errors, isSubmitting },
    watch,
  } = form;

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/companies/work-hours");
        const wh = res.data.workHours || {};
        reset({
          start: wh.start || "",
          end: wh.end || "",
          graceMinutes:
            typeof wh.graceMinutes === "number" ? wh.graceMinutes : 0,
          minFullDayHours:
            typeof wh.minFullDayHours === "number" ? wh.minFullDayHours : 6,
          minHalfDayHours:
            typeof wh.minHalfDayHours === "number"
              ? wh.minHalfDayHours
              : Math.min(
                  3,
                  typeof wh.minFullDayHours === "number"
                    ? wh.minFullDayHours
                    : 6,
                ),
        });
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.warn(e?.response?.data?.error || e?.message || e);
        toast.error(e?.response?.data?.error || "Failed to load work hours");
      } finally {
        setLoading(false);
      }
    })();
  }, [reset]);

  const onSubmit: SubmitHandler<FormValues> = async (data) => {
    setOk(null);
    setErr(null);
    try {
      await api.put("/companies/work-hours", {
        start: data.start,
        end: data.end,
        graceMinutes: data.graceMinutes,
        minFullDayHours: data.minFullDayHours,
        minHalfDayHours: data.minHalfDayHours,
      });
      setOk("Company work hours updated");
    } catch (e: any) {
      const msg = e?.response?.data?.error || "Failed to update work hours";
      setErr(msg);
      toast.error(msg);
    }
  };

  const start = watch("start");
  const end = watch("end");
  const grace = watch("graceMinutes") ?? 0;
  const minFull: any = watch("minFullDayHours");
  const minHalf: any = watch("minHalfDayHours");
  const durationM =
    timeRegex.test(start) && timeRegex.test(end) && toMin(end) > toMin(start)
      ? toMin(end) - toMin(start)
      : null;

  if (loading) return <div>Loading…</div>;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold">Company Timing</h2>
        <p className="text-sm text-muted-foreground">
          Configure default work hours and grace period.
        </p>
      </div>

      {err && (
        <div className="rounded-md border border-error/20 bg-error/10 px-4 py-2 text-sm text-error">
          {err}
        </div>
      )}
      {ok && (
        <div className="rounded-md border border-success/20 bg-success/10 px-4 py-2 text-sm text-success">
          {ok}
        </div>
      )}

      <section className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="border-b border-border px-6 py-4">
          <h3 className="text-lg font-semibold">Work Hours</h3>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleSubmit(onSubmit)(e);
          }}
          className="px-6 py-5 space-y-5"
        >
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Start Time" required>
              <input
                type="time"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                {...register("start")}
                aria-invalid={!!errors.start}
              />
              {errors.start && (
                <p className="text-xs text-error mt-1">
                  {errors.start.message}
                </p>
              )}
            </Field>

            <Field label="End Time" required>
              <input
                type="time"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                {...register("end")}
                aria-invalid={!!errors.end}
              />
              {errors.end && (
                <p className="text-xs text-error mt-1">{errors.end.message}</p>
              )}
            </Field>

            <Field label="Grace Minutes" required>
              <input
                type="number"
                min={0}
                step={1}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                {...register("graceMinutes", { valueAsNumber: true })}
                aria-invalid={!!errors.graceMinutes}
                required
              />
              {errors.graceMinutes && (
                <p className="text-xs text-error mt-1">
                  {errors.graceMinutes.message}
                </p>
              )}
            </Field>

            <Field label="Full Day Minimum Hours" required>
              <input
                type="number"
                min={0.25}
                step={0.25}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                {...register("minFullDayHours", { valueAsNumber: true })}
                aria-invalid={!!errors.minFullDayHours}
                required
              />
              {errors.minFullDayHours && (
                <p className="text-xs text-error mt-1">
                  {errors.minFullDayHours.message}
                </p>
              )}
            </Field>

            <Field label="Half Day Minimum Hours" required>
              <input
                type="number"
                min={0}
                step={0.25}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                {...register("minHalfDayHours", { valueAsNumber: true })}
                aria-invalid={!!errors.minHalfDayHours}
                required
              />
              {errors.minHalfDayHours && (
                <p className="text-xs text-error mt-1">
                  {errors.minHalfDayHours.message}
                </p>
              )}
            </Field>
          </div>

          {durationM !== null && (
            <div className="text-xs text-muted-foreground">
              Workday length: {Math.floor(durationM / 60)}h {durationM % 60}m
              {grace ? ` • Grace: ${grace}m` : ""}
            </div>
          )}
          {Number.isFinite(minFull) && Number.isFinite(minHalf) && (
            <div className="text-xs text-muted-foreground">
              Full day requires ≥ {minFull}h • Half day requires ≥{" "}
              {Math.min(minHalf, minFull)}h
            </div>
          )}

          <div className="pt-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-white disabled:opacity-60"
            >
              {isSubmitting ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
