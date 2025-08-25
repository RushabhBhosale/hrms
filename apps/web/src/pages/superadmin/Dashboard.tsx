import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

export default function SADash() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    api
      .get('/companies')
      .then(res => setCount(res.data.companies.length))
      .catch(err => console.error(err));
  }, []);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">Superadmin Dashboard</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="p-4 bg-gray-100 rounded">Total Companies: {count}</div>
      </div>
    </div>
  );
}
