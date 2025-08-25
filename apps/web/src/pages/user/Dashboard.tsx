import RoleGuard from '../../components/RoleGuard';

export default function UserDash() {
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold">User Area</h2>
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
        <div className="p-4 border rounded">General</div>
        <RoleGuard sub={["hr"]}><div className="p-4 border rounded">HR Panel</div></RoleGuard>
        <RoleGuard sub={["manager"]}><div className="p-4 border rounded">Manager Panel</div></RoleGuard>
      </div>
    </div>
  );
}
