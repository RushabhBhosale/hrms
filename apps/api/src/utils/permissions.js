const path = require('path');

const permissionModules = require(path.join(__dirname, '../../../../libs/role-modules.json'));

function buildBlankPermissions(defaultValue = false) {
  const result = {};
  for (const moduleDef of permissionModules) {
    const moduleKey = moduleDef.key;
    result[moduleKey] = {};
    for (const action of moduleDef.actions) {
      result[moduleKey][action.key] = !!defaultValue;
    }
  }
  return result;
}

function applyOverrides(overrides = {}) {
  const base = buildBlankPermissions(false);
  for (const [moduleKey, actions] of Object.entries(overrides || {})) {
    if (!base[moduleKey]) continue;
    for (const [actionKey, flag] of Object.entries(actions || {})) {
      if (typeof base[moduleKey][actionKey] === 'boolean') {
        base[moduleKey][actionKey] = !!flag;
      }
    }
  }
  return base;
}

const DEFAULT_ROLE_CONFIGS = {
  admin: {
    label: 'Admin',
    description: 'Full access to every module.',
    system: true,
    canDelete: false,
    allowRename: false,
    modules: applyOverrides({
      daily_status: { send: true },
    }, buildBlankPermissions(true)),
  },
  hr: {
    label: 'HR Manager',
    description: 'Oversees people operations, leave, payroll, and announcements.',
    system: true,
    canDelete: false,
    allowRename: true,
    modules: applyOverrides({
      dashboard: { read: true },
      employees: { read: true, write: true },
      roles: { read: true, write: true },
      projects: { read: true },
      attendance: { read: true, write: true },
      presence: { read: true },
      leaves: { read: true, write: true },
      leave_settings: { read: true, write: true },
      reports: { read: true },
      salary: { read: true, write: true },
      finance: { read: true },
      announcements: { read: true, write: true },
      company: { read: true, write: true },
      documents: { read: true, write: true },
      tasks: { read: true, status: true },
      kras: { read: true, write: true },
      appraisals: { read: true, write: true },
      onboarding: { read: true, write: true },
      inventory: { read: true, write: true },
    }),
  },
  manager: {
    label: 'Manager',
    description: 'Leads teams, assigns work, and approves requests.',
    system: true,
    canDelete: false,
    allowRename: true,
    modules: applyOverrides({
      dashboard: { read: true },
      employees: { read: true },
      projects: { read: true, write: true },
      attendance: { read: true },
      presence: { read: true },
      leaves: { read: true, write: true },
      reports: { read: true },
      announcements: { read: true },
      documents: { read: true },
      tasks: { read: true, status: true },
      kras: { read: true },
      appraisals: { read: true },
      onboarding: { read: true },
      inventory: { read: true },
    }),
  },
};

function sanitizeModules(rawModules = {}, fallback = undefined) {
  const result = {};
  for (const moduleDef of permissionModules) {
    const moduleKey = moduleDef.key;
    const moduleFallback = fallback && fallback[moduleKey];
    const rawModule = rawModules && rawModules[moduleKey];
    result[moduleKey] = {};
    for (const action of moduleDef.actions) {
      const fallbackValue =
        typeof moduleFallback?.[action.key] === 'boolean'
          ? moduleFallback[action.key]
          : false;
      const rawValue = rawModule?.[action.key];
      result[moduleKey][action.key] =
        typeof rawValue === 'boolean' ? rawValue : fallbackValue;
    }
  }
  return result;
}

function modulesEqual(left = {}, right = {}) {
  for (const moduleDef of permissionModules) {
    const moduleKey = moduleDef.key;
    for (const action of moduleDef.actions) {
      const leftValue = !!left?.[moduleKey]?.[action.key];
      const rightValue = !!right?.[moduleKey]?.[action.key];
      if (leftValue !== rightValue) return false;
    }
  }
  return true;
}

function toTitleCase(value) {
  return String(value || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : ''))
    .join(' ');
}

function formatRoleLabel(name) {
  const formatted = toTitleCase(name);
  return formatted || 'Role';
}

function slugifyRoleName(value) {
  if (!value) return '';
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

function ensureCompanyRoleDefaults(company) {
  if (!company) return false;
  let changed = false;

  if (!Array.isArray(company.roles)) {
    company.roles = [];
    changed = true;
  }

  if (!company.roleSettings || typeof company.roleSettings !== 'object') {
    company.roleSettings = {};
    changed = true;
  }

  const settings = company.roleSettings;

  for (const [roleKey, def] of Object.entries(DEFAULT_ROLE_CONFIGS)) {
    if (!company.roles.includes(roleKey)) {
      company.roles.unshift(roleKey);
      changed = true;
    }
    const existing = settings[roleKey] || {};
    const normalizedModules = sanitizeModules(existing.modules, def.modules);
    const next = {
      label: existing.label || def.label,
      description: existing.description || def.description || '',
      modules: normalizedModules,
      system: true,
      canDelete: false,
      allowRename: def.allowRename,
    };
    if (
      existing.label !== next.label ||
      existing.description !== next.description ||
      existing.system !== true ||
      existing.canDelete !== false ||
      existing.allowRename !== def.allowRename ||
      !modulesEqual(existing.modules, normalizedModules)
    ) {
      settings[roleKey] = next;
      changed = true;
    } else {
      settings[roleKey].modules = normalizedModules;
      settings[roleKey].system = true;
      settings[roleKey].canDelete = false;
      settings[roleKey].allowRename = def.allowRename;
    }
  }

  for (const roleName of company.roles) {
    if (!settings[roleName]) {
      settings[roleName] = {
        label: formatRoleLabel(roleName),
        description: '',
        modules: buildBlankPermissions(false),
        system: false,
        canDelete: true,
        allowRename: true,
      };
      changed = true;
      continue;
    }
    const base = DEFAULT_ROLE_CONFIGS[roleName]?.modules;
    const normalized = sanitizeModules(settings[roleName].modules, base);
    if (!modulesEqual(settings[roleName].modules, normalized)) {
      settings[roleName].modules = normalized;
      changed = true;
    } else {
      settings[roleName].modules = normalized;
    }
    if (typeof settings[roleName].label !== 'string' || !settings[roleName].label.trim()) {
      settings[roleName].label = formatRoleLabel(roleName);
      changed = true;
    }
    if (typeof settings[roleName].description !== 'string') {
      settings[roleName].description = '';
      changed = true;
    }
    if (typeof settings[roleName].system !== 'boolean') {
      settings[roleName].system = !!DEFAULT_ROLE_CONFIGS[roleName]?.system;
      changed = true;
    }
    if (typeof settings[roleName].canDelete !== 'boolean') {
      settings[roleName].canDelete = !settings[roleName].system;
      changed = true;
    }
    if (typeof settings[roleName].allowRename !== 'boolean') {
      settings[roleName].allowRename = !settings[roleName].system;
      changed = true;
    }
  }

  if (changed && typeof company.markModified === 'function') {
    company.markModified('roles');
    company.markModified('roleSettings');
  }
  return changed;
}

function mapRolesForResponse(company) {
  const settings = company?.roleSettings || {};
  const roles = Array.isArray(company?.roles) ? company.roles : [];
  return roles.map((roleName) => {
    const meta = settings[roleName] || {};
    return {
      name: roleName,
      label: meta.label || formatRoleLabel(roleName),
      description: meta.description || '',
      system: !!meta.system,
      canDelete: meta.canDelete !== undefined ? !!meta.canDelete : !meta.system,
      allowRename: meta.allowRename !== undefined ? !!meta.allowRename : !meta.system,
      modules: sanitizeModules(meta.modules, DEFAULT_ROLE_CONFIGS[roleName]?.modules),
    };
  });
}

function combineRolePermissions(company, subRoles = []) {
  const effective = buildBlankPermissions(false);
  if (!company || !Array.isArray(subRoles)) return effective;
  const settings = company.roleSettings || {};
  for (const roleName of subRoles) {
    const meta = settings[roleName];
    if (!meta || !meta.modules) continue;
    for (const moduleDef of permissionModules) {
      const moduleKey = moduleDef.key;
      const modulePerm = meta.modules[moduleKey] || {};
      const target = effective[moduleKey];
      for (const action of moduleDef.actions) {
        if (modulePerm[action.key]) {
          target[action.key] = true;
        }
      }
    }
  }
  return effective;
}

function computeEmployeePermissions(company, employee) {
  if (!employee) return buildBlankPermissions(false);
  if (employee.primaryRole === 'SUPERADMIN') return buildBlankPermissions(true);
  if (employee.primaryRole === 'ADMIN') return buildBlankPermissions(true);
  if (!company) return buildBlankPermissions(false);
  ensureCompanyRoleDefaults(company);
  return combineRolePermissions(company, employee.subRoles || []);
}

function sanitizeIncomingPermissions(input, fallback) {
  if (!input || typeof input !== 'object') {
    return sanitizeModules({}, fallback);
  }
  return sanitizeModules(input, fallback);
}

module.exports = {
  permissionModules,
  buildBlankPermissions,
  applyOverrides,
  DEFAULT_ROLE_CONFIGS,
  ensureCompanyRoleDefaults,
  mapRolesForResponse,
  combineRolePermissions,
  computeEmployeePermissions,
  sanitizeIncomingPermissions,
  slugifyRoleName,
  formatRoleLabel,
};
