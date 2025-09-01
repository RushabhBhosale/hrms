import { useEffect, useState } from "react";
import { api } from "../../lib/api";

export default function Documents() {
  const [docs, setDocs] = useState<string[]>([]);
  const [files, setFiles] = useState<FileList | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function load() {
    try {
      setLoading(true);
      const res = await api.get("/documents");
      setDocs(res.data.documents || []);
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to load documents");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function uploadDocs(e: React.FormEvent) {
    e.preventDefault();
    if (!files || files.length === 0) return;
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append("documents", f));
    try {
      setErr(null);
      setOk(null);
      const res = await api.post("/documents", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setDocs(res.data.documents || []);
      setFiles(null);
      (e.target as HTMLFormElement).reset();
      setOk("Uploaded");
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Upload failed");
    }
  }

  const base = import.meta.env.VITE_API_URL || "http://localhost:4000";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold">Documents</h2>
        <p className="text-sm text-muted">Upload and view your documents.</p>
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

      <form onSubmit={uploadDocs} className="space-y-3">
        <input
          type="file"
          multiple
          onChange={(e) => setFiles(e.target.files)}
        />
        <button
          type="submit"
          className="rounded-md bg-primary px-4 py-2 text-white"
        >
          Upload
        </button>
      </form>

      <section>
        <h3 className="font-semibold mb-2">Uploaded</h3>
        {loading ? (
          <div className="text-sm text-muted">Loading…</div>
        ) : docs.length === 0 ? (
          <div className="text-sm text-muted">No documents uploaded.</div>
        ) : (
          <ul className="list-disc pl-6 space-y-1">
            {docs.map((d) => (
              <li key={d}>
                <a
                  href={`${base}/uploads/${d}`}
                  target="_blank"
                  className="text-primary underline"
                >
                  {d}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
