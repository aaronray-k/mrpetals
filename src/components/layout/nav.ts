import { Boxes, Building2, FileSpreadsheet, Flower2, LayoutDashboard, Store, Tags, type LucideIcon } from 'lucide-react'
import { ROLES, type Role } from '~/lib/roles'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** One-line navigation tip, shown under the label while tips are on. */
  tip: string
  roles: Role[] | 'all'
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

export const NAV: NavGroup[] = [
  {
    label: 'Overview',
    items: [{ to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, tip: 'Your shortcuts and what needs attention', roles: 'all' }],
  },
  {
    label: 'Master data',
    items: [
      { to: '/farms', label: 'Farms', icon: Building2, tip: 'Growers, sales agents and payment terms', roles: ['admin', 'consolidator', 'finance', 'qc'] },
      { to: '/customers', label: 'Customers', icon: Store, tip: 'Buyers, incoterms and credit limits', roles: ['admin', 'consolidator', 'finance'] },
      { to: '/products', label: 'Products', icon: Flower2, tip: 'Varieties, grades and stem lengths', roles: ['admin', 'consolidator', 'finance', 'qc', 'farm'] },
      { to: '/box-types', label: 'Box types', icon: Boxes, tip: 'Box sizes and volumetric weight', roles: ['admin', 'consolidator', 'qc'] },
    ],
  },
  {
    label: 'Tools',
    items: [
      { to: '/import', label: 'Import', icon: FileSpreadsheet, tip: 'Load data from the Excel template', roles: ['admin', 'consolidator'] },
      { to: '/labels', label: 'Label designer', icon: Tags, tip: 'Box label layouts, QR code and test prints', roles: ['admin'] },
    ],
  },
]

export function navFor(roles: Role[]): NavGroup[] {
  return NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => i.roles === 'all' || i.roles.some((r) => roles.includes(r))),
  })).filter((g) => g.items.length > 0)
}

/** Who may open a page. The menu is the single source of truth, so a page and its menu item can't disagree. */
export function rolesFor(to: string): Role[] {
  const item = NAV.flatMap((g) => g.items).find((i) => i.to === to)
  if (!item) throw new Error(`No menu item for ${to}`)
  return item.roles === 'all' ? [...ROLES] : item.roles
}
