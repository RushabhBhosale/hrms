import ProjectTime from "../../report/ProjectTime";

export default function ProjectReportPage() {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Project Reports</h2>
      <div className="rounded-lg border border-border bg-surface shadow-sm p-5">
        <ProjectTime />
      </div>
    </div>
  );
}
