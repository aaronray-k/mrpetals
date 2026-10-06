export const ROLES = ['admin', 'consolidator', 'customer', 'farm', 'qc', 'finance'] as const
export type Role = (typeof ROLES)[number]

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  consolidator: 'Consolidator',
  customer: 'Customer',
  farm: 'Farm',
  qc: 'QC',
  finance: 'Finance',
}

/** Roles that can create and change master data (farms, products, prices...). */
export const STAFF_ROLES: Role[] = ['admin', 'consolidator']

export function hasAnyRole(userRoles: readonly Role[], allowed: readonly Role[]) {
  return userRoles.some((r) => allowed.includes(r))
}
