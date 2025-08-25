import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

interface CompanyUser {
  id: string;
  name: string;
  email: string;
  subRoles: string[];
}

export default function UserList() {
  const [users, setUsers] = useState<CompanyUser[]>([]);

  useEffect(() => {
    api
      .get('/companies/users')
      .then(res => setUsers(res.data.users))
      .catch(err => console.error(err));
  }, []);

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold">User List</h2>
      <table className="w-full text-sm border">
        <thead>
          <tr className="border-b">
            <th className="p-1 text-left">Name</th>
            <th className="p-1 text-left">Email</th>
            <th className="p-1 text-left">Role</th>
          </tr>
        </thead>
        <tbody>
          {users.map(u => (
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
