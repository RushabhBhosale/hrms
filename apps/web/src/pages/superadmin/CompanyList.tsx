import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

type Company = {
  _id: string;
  name: string;
  admin?: { name: string; email: string };
};

export default function CompanyList() {
  const [companies, setCompanies] = useState<Company[]>([]);

  useEffect(() => {
    api
      .get('/companies')
      .then(res => setCompanies(res.data.companies))
      .catch(err => console.error(err));
  }, []);

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold">Company List</h2>
      <ul className="space-y-1 text-sm">
        {companies.map(c => (
          <li key={c._id}>
            {c.name} – {c.admin ? `${c.admin.name} (${c.admin.email})` : 'No admin'}
          </li>
        ))}
      </ul>
    </div>
  );
}
