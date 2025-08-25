export type PrimaryRole = 'SUPERADMIN' | 'ADMIN' | 'USER';
export type SubRole = 'hr' | 'manager' | 'plain';

export type User = {
  id: string;
  name: string;
  email: string;
  primaryRole: PrimaryRole;
  subRoles: SubRole[];
};

export function setAuth(token: string, user: User) {
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
}

export function getUser(): User | null {
  const raw = localStorage.getItem('user');
  if (!raw) return null;
  try { return JSON.parse(raw) as User } catch { return null }
}

export function clearAuth() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
}
