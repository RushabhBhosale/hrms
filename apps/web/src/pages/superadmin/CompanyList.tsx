import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

type Company = {
  _id: string;
  name: string;
  admin?: { name: string; email: string };
  status?: 'pending' | 'approved' | 'rejected';
  requestedAdmin?: { name?: string; email?: string };
};

export default function CompanyList() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const res = await api.get('/companies');
        setCompanies(res.data.companies || []);
      } catch (e: any) {
        setErr(e?.response?.data?.error || 'Failed to load companies');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">Company List</h2>

      {err && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {err}
        </div>
      )}

      <div className="rounded-lg border border-border bg-surface shadow-sm overflow-hidden">
        <div className="grid grid-cols-12 text-xs font-medium uppercase text-muted border-b border-border px-4 py-2">
          <div className="col-span-4">Company</div>
          <div className="col-span-3">Admin</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-3 text-right">Actions</div>
        </div>

        {loading ? (
          <div className="px-4 py-4 text-sm text-muted">Loading…</div>
        ) : companies.length === 0 ? (
          <div className="px-4 py-4 text-sm text-muted">No companies</div>
        ) : (
          companies.map((c) => (
            <Row key={c._id} company={c} onChange={setCompanies} />
          ))
        )}
      </div>
    </div>
  );
}

function Row({ company, onChange }: { company: Company; onChange: (v: Company[]) => void }) {
  const [working, setWorking] = useState(false);

  async function reload() {
    const res = await api.get('/companies');
    onChange(res.data.companies || []);
  }

  async function approve() {
    setWorking(true);
    try {
      await api.post(`/companies/${company._id}/approve`);
      await reload();
    } finally {
      setWorking(false);
    }
  }

  async function reject() {
    setWorking(true);
    try {
      await api.post(`/companies/${company._id}/reject`);
      await reload();
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="grid grid-cols-12 items-center px-4 py-3 border-b border-border text-sm last:border-b-0">
      <div className="col-span-4">
        <div className="font-medium">{company.name}</div>
        {company.status === 'pending' && company.requestedAdmin?.email && (
          <div className="text-xs text-muted">Requested by: {company.requestedAdmin.name || 'Admin'} ({company.requestedAdmin.email})</div>
        )}
      </div>
      <div className="col-span-3">
        {company.admin ? (
          <span>{company.admin.name} ({company.admin.email})</span>
        ) : (
          <span className="text-muted">No admin</span>
        )}
      </div>
      <div className="col-span-2">
        <StatusPill status={company.status || 'approved'} />
      </div>
      <div className="col-span-3 flex items-center justify-end gap-2">
        {company.status === 'pending' ? (
          <>
            <button
              onClick={approve}
              disabled={working}
              className="inline-flex items-center h-8 px-3 rounded-md bg-green-600 text-white disabled:opacity-60"
            >
              Approve
            </button>
            <button
              onClick={reject}
              disabled={working}
              className="inline-flex items-center h-8 px-3 rounded-md border border-border hover:bg-bg"
            >
              Reject
            </button>
          </>
        ) : (
          <span className="text-xs text-muted">—</span>
        )}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: NonNullable<Company['status']> }) {
  const styles = {
    approved: 'bg-green-100 text-green-700 border-green-200',
    pending: 'bg-amber-100 text-amber-800 border-amber-200',
    rejected: 'bg-red-100 text-red-700 border-red-200',
  } as const;
  return (
    <span className={`inline-flex items-center h-6 px-2 rounded-full text-xs border ${styles[status]}`}>
      {status}
    </span>
  );
}
