import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

interface CompanyEmployee {
  id: string;
  name: string;
  email: string;
  subRoles: string[];
}

export default function EmployeeList() {
  const [employees, setEmployees] = useState<CompanyEmployee[]>([]);

  useEffect(() => {
    api
      .get('/companies/employees')
      .then(res => setEmployees(res.data.employees))
      .catch(err => console.error(err));
  }, []);

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold">Employee List</h2>
      <table className="w-full text-sm border">
        <thead>
          <tr className="border-b">
            <th className="p-1 text-left">Name</th>
            <th className="p-1 text-left">Email</th>
            <th className="p-1 text-left">Role</th>
          </tr>
        </thead>
        <tbody>
          {employees.map(u => (
            <tr key={u.id} className="border-b">
              <td className="p-1">{u.name}</td>
              <td className="p-1">{u.email}</td>
              <td className="p-1">{u.subRoles[0]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
