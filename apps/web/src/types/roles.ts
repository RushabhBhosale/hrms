export type RoleModuleAction = {
  key: string;
  label: string;
};

export type RoleModuleDefinition = {
  key: string;
  label: string;
  description: string;
  actions: RoleModuleAction[];
};

export type RolePermissionMap = Record<string, Record<string, boolean>>;

export type RoleDefinition = {
  name: string;
  label: string;
  description: string;
  system: boolean;
  canDelete: boolean;
  allowRename: boolean;
  modules: RolePermissionMap;
};
