import { ArrowLeftRight, Bell, Boxes, Building2, CalendarClock, ClipboardList, FileSpreadsheet, Flower2, LayoutDashboard, ListChecks, Mail, Percent, Plane, ScanLine, Settings, ShoppingBasket, Store, Tag, Tags, Truck, Users, type LucideIcon } from 'lucide-react'
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
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, tip: 'Your shortcuts and what needs attention', roles: 'all' },
      { to: '/notifications', label: 'Notifications', icon: Bell, tip: 'Updates on your orders', roles: 'all' },
    ],
  },
  {
    label: 'Buy flowers',
    items: [
      { to: '/shop', label: 'Catalog', icon: ShoppingBasket, tip: 'Prices per variety and length; add to cart', roles: ['customer'] },
      { to: '/my-orders', label: 'My orders', icon: ListChecks, tip: 'Where each order is now', roles: ['customer'] },
      { to: '/standing-orders', label: 'Standing orders', icon: CalendarClock, tip: 'Orders that repeat every week', roles: ['customer'] },
    ],
  },
  {
    label: 'Orders and shipping',
    items: [
      { to: '/orders', label: 'Orders', icon: ClipboardList, tip: 'Buyer orders, split across farms', roles: ['admin', 'consolidator', 'finance'] },
      { to: '/qc/scan', label: 'Scan boxes', icon: ScanLine, tip: 'QC: scan, check and send back boxes', roles: ['qc', 'senior_qc', 'admin', 'consolidator'] },
      { to: '/shipments', label: 'Shipments', icon: Plane, tip: 'Flights, boxes, labels and packing lists', roles: ['admin', 'consolidator', 'finance', 'qc', 'senior_qc'] },
      { to: '/farm/orders', label: 'My purchase orders', icon: Truck, tip: 'Confirm what ConsolFlora ordered from you', roles: ['farm'] },
    ],
  },
  {
    label: 'Master data',
    items: [
      { to: '/farms', label: 'Farms', icon: Building2, tip: 'Growers, sales agents and payment terms', roles: ['admin', 'consolidator', 'finance', 'qc', 'senior_qc'] },
      { to: '/customers', label: 'Customers', icon: Store, tip: 'Buyers, incoterms and credit limits', roles: ['admin', 'consolidator', 'finance'] },
      { to: '/products', label: 'Products', icon: Flower2, tip: 'Varieties, grades and stem lengths', roles: ['admin', 'consolidator', 'finance', 'qc', 'senior_qc', 'farm'] },
      { to: '/box-types', label: 'Box types', icon: Boxes, tip: 'Box sizes and volumetric weight', roles: ['admin', 'consolidator', 'qc', 'senior_qc'] },
      { to: '/prices', label: 'Selling prices', icon: Tag, tip: 'Pin a farm or fix a price per product', roles: ['admin', 'consolidator', 'finance'] },
      { to: '/exchange-rates', label: 'Exchange rates', icon: ArrowLeftRight, tip: 'Convert farm prices into each buyer\'s currency', roles: ['admin', 'consolidator', 'finance'] },
      { to: '/margins', label: 'Margins', icon: Percent, tip: 'ConsolFlora margin per stem, by incoterm', roles: ['admin', 'consolidator', 'finance'] },
    ],
  },
  {
    label: 'Tools',
    items: [
      { to: '/import', label: 'Import', icon: FileSpreadsheet, tip: 'Load data from the Excel template', roles: ['admin', 'consolidator'] },
      { to: '/users', label: 'Users', icon: Users, tip: 'Create accounts and give roles', roles: ['admin'] },
      { to: '/settings/email', label: 'Email settings', icon: Mail, tip: 'Zoho mailbox details (email is off for now)', roles: ['admin'] },
      { to: '/settings/ordering', label: 'Ordering settings', icon: Settings, tip: 'Lead time and farm delivery hours', roles: ['admin'] },
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
