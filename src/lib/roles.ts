export const ROLES = ['admin', 'consolidator', 'customer', 'farm', 'qc', 'senior_qc', 'finance'] as const
export type Role = (typeof ROLES)[number]

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  consolidator: 'Consolidator',
  customer: 'Customer',
  farm: 'Farm',
  qc: 'QC',
  senior_qc: 'Senior QC',
  finance: 'Finance',
}

/** Roles that can create and change master data (farms, products, prices...). */
export const STAFF_ROLES: Role[] = ['admin', 'consolidator']

/** Can scan boxes and record QC results. */
export const QC_ROLES: Role[] = ['admin', 'consolidator', 'qc', 'senior_qc']
/** Can clear a Major QC failure. */
export const QC_CLEAR_ROLES: Role[] = ['admin', 'senior_qc']

export function hasAnyRole(userRoles: readonly Role[], allowed: readonly Role[]) {
  return userRoles.some((r) => allowed.includes(r))
}
