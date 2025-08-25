import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { Users, UserCheck } from "lucide-react";

export default function AdminDash() {
  const [stats, setStats] = useState({ employees: 0, present: 0 });

  useEffect(() => {
    async function load() {
      try {
        const employees = await api.get("/companies/employees");
        const att = await api.get("/attendance/company/today");
        setStats({
          employees: employees.data.employees.length,
          present: att.data.attendance.length,
        });
      } catch (err) {
        console.error(err);
      }
    }
    load();
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold">Admin Dashboard</h2>
        <p className="text-sm text-muted">
          Overview of company workforce and attendance today.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Card
          icon={<Users size={22} />}
          title="Total Employees"
          value={stats.employees}
          tone="primary"
        />
        <Card
          icon={<UserCheck size={22} />}
          title="Today's Attendance"
          value={stats.present}
          tone="secondary"
        />
      </div>
    </div>
  );
}

function Card({
  icon,
  title,
  value,
  tone = "primary",
}: {
  icon: React.ReactNode;
  title: string;
  value: number;
  tone?: "primary" | "secondary" | "accent";
}) {
  const tones: Record<string, string> = {
    primary: "bg-primary/10 text-primary",
    secondary: "bg-secondary/10 text-secondary",
    accent: "bg-accent/10 text-accent",
  };

  return (
    <div className="rounded-xl border border-border bg-surface p-6 shadow-sm flex items-center gap-4">
      <div
        className={`flex h-12 w-12 items-center justify-center rounded-full ${tones[tone]}`}
      >
        {icon}
      </div>
      <div className="space-y-1">
        <div className="text-sm text-muted">{title}</div>
        <div className="text-2xl font-semibold">{value}</div>
      </div>
    </div>
  );
}
