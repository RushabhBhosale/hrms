import { useState } from "react";
import MonthlyReport from "./MonthlyReport";
import ProjectTime from "./ProjectTime";

export default function Reports() {
  const [tab, setTab] = useState<"ATTENDANCE" | "PROJECTS">("ATTENDANCE");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Reports</h2>
        <div className="inline-flex rounded-md border border-border overflow-hidden bg-surface">
          <button
            className={`px-3 py-2 text-sm ${
              tab === "ATTENDANCE" ? "bg-primary/10 text-primary font-medium" : ""
            }`}
            onClick={() => setTab("ATTENDANCE")}
          >
            Attendance
          </button>
          <button
            className={`px-3 py-2 text-sm border-l border-border ${
              tab === "PROJECTS" ? "bg-primary/10 text-primary font-medium" : ""
            }`}
            onClick={() => setTab("PROJECTS")}
          >
            Projects
          </button>
        </div>
      </div>

      {tab === "ATTENDANCE" ? (
        <MonthlyReport />
      ) : (
        <div className="rounded-lg border border-border bg-surface shadow-sm p-5">
          <ProjectTime />
        </div>
      )}
    </div>
  );
}

