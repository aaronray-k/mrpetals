/**
 * Sheet definitions for ConsolFlora_Import_Template.xlsx (version 1.0).
 * This file drives the dry run and the import; a test checks it against the
 * template in public/templates so the two can't drift apart.
 */

export const SHEET_ORDER = [
  'Lists',
  'Farms',
  'Customers',
  'BoxTypes',
  'Products',
  'PackRates',
  'PriceList',
  'FreightRates',
  'PackingList',
] as const
export type SheetName = (typeof SHEET_ORDER)[number]

export const LIST_NAMES = ['Currency', 'Incoterm', 'PaymentTerms', 'YesNo', 'Language', 'Maturity', 'Country'] as const
export type ListName = (typeof LIST_NAMES)[number]

/** Sheets whose codes other sheets point at. */
export type CodeKind = 'farm_code' | 'customer_code' | 'product_code' | 'box_code'
export const CODE_SHEET: Record<CodeKind, SheetName> = {
  farm_code: 'Farms',
  customer_code: 'Customers',
  product_code: 'Products',
  box_code: 'BoxTypes',
}

export type ColumnType =
  | 'text'
  | 'code' // a key: trimmed, case-sensitive, no spaces
  | 'email'
  | 'phone'
  | 'int' // whole number
  | 'decimal'
  | 'date' // YYYY-MM-DD
  | 'gln' // 13 digits with GS1 check digit
  | 'iata' // 3-letter airport code
  | 'awb' // air waybill: 3-digit airline prefix + 8 digits
  | 'yesno' // Y or N, stored as boolean

export interface ColumnDef {
  key: string
  type: ColumnType
  required?: boolean
  /** Value must appear on this list of the Lists sheet. */
  list?: ListName
  /** Value must be a code that exists on another sheet. */
  ref?: CodeKind
  /** Lowest allowed number. */
  min?: number
  maxLength?: number
  /** A spreadsheet formula. Ignored on import: the app works it out itself. */
  calculated?: boolean
}

export interface SheetDef {
  name: SheetName
  /** Plain-words description shown in the sheet picker. */
  description: string
  columns: ColumnDef[]
  /** Columns that identify a record. A key already in the database updates it; a new key inserts. */
  key: string[]
  /** The template's example row. Importing it by mistake is an error. */
  example?: Record<string, string | number>
}

const c = (key: string, type: ColumnType, extra: Omit<ColumnDef, 'key' | 'type'> = {}): ColumnDef => ({ key, type, ...extra })
const req = (key: string, type: ColumnType, extra: Omit<ColumnDef, 'key' | 'type' | 'required'> = {}) =>
  c(key, type, { ...extra, required: true })

export const SHEETS: Record<SheetName, SheetDef> = {
  Lists: {
    name: 'Lists',
    description: 'Dropdown values: currencies, incoterms, payment terms, countries…',
    // Lists is laid out as one column per list, so it is parsed separately (see parse.ts).
    columns: [req('list_name', 'text'), req('value', 'text', { maxLength: 60 })],
    key: ['list_name', 'value'],
  },
  Farms: {
    name: 'Farms',
    description: 'Growers, their sales agent and payment terms',
    columns: [
      req('farm_code', 'code'),
      req('farm_name', 'text'),
      req('country', 'text', { list: 'Country' }),
      c('region', 'text'),
      c('address', 'text'),
      c('gln', 'gln'),
      c('kra_pin', 'text', { maxLength: 20 }),
      req('sales_agent_name', 'text'),
      req('sales_agent_email', 'email'),
      c('sales_agent_phone', 'phone'),
      req('currency', 'text', { list: 'Currency' }),
      // Empty: "15th of following month" for a new supplier; an existing one keeps its terms.
      c('payment_terms', 'text', { list: 'PaymentTerms' }),
      req('active', 'yesno'),
    ],
    key: ['farm_code'],
    example: { farm_code: 'SIAN', farm_name: 'Example Farm Ltd' },
  },
  Customers: {
    name: 'Customers',
    description: 'Buyers, incoterms and credit limits',
    columns: [
      req('customer_code', 'code'),
      req('company_name', 'text'),
      req('country', 'text', { list: 'Country' }),
      c('city', 'text'),
      c('delivery_address', 'text'),
      c('gln', 'gln'),
      c('vat_or_tax_id', 'text', { maxLength: 30 }),
      req('contact_name', 'text'),
      req('contact_email', 'email'),
      c('contact_phone', 'phone'),
      req('currency', 'text', { list: 'Currency' }),
      req('incoterm', 'text', { list: 'Incoterm' }),
      req('payment_terms', 'text', { list: 'PaymentTerms' }),
      c('credit_limit', 'decimal', { min: 0 }),
      req('destination_airport', 'iata'),
      c('language', 'text', { list: 'Language' }),
      req('active', 'yesno'),
    ],
    key: ['customer_code'],
    example: { customer_code: 'FDAMS', company_name: 'Example Flowers BV' },
  },
  BoxTypes: {
    name: 'BoxTypes',
    description: 'Box sizes and weights',
    columns: [
      req('box_code', 'code'),
      c('description', 'text'),
      req('length_cm', 'decimal', { min: 0.01 }),
      req('width_cm', 'decimal', { min: 0.01 }),
      req('height_cm', 'decimal', { min: 0.01 }),
      c('tare_weight_kg', 'decimal', { min: 0 }),
      c('volumetric_kg', 'decimal', { calculated: true }),
      c('vbn_packaging_code', 'text'),
      req('active', 'yesno'),
    ],
    key: ['box_code'],
    example: { box_code: 'QB', description: 'Quarter box (example dimensions)' },
  },
  Products: {
    name: 'Products',
    description: 'Flower, variety, grade and stem length per product code',
    columns: [
      req('product_code', 'code'),
      req('flower_type', 'text'),
      req('variety', 'text'),
      c('colour', 'text'),
      c('floricode_product_id', 'text'),
      c('vbn_code', 'text'),
      req('grade', 'text'),
      req('stem_length_cm', 'int', { min: 1 }),
      c('head_size_cm', 'decimal', { min: 0 }),
      c('maturity', 'text', { list: 'Maturity' }),
      req('stems_per_bunch', 'int', { min: 1 }),
      c('default_farm_code', 'code', { ref: 'farm_code' }),
      req('active', 'yesno'),
    ],
    key: ['product_code'],
    example: { product_code: 'ROS-RN-A1-70', variety: 'Red Naomi!', default_farm_code: 'SIAN' },
  },
  PackRates: {
    name: 'PackRates',
    description: 'How many bunches of each product fit in each box',
    columns: [
      req('product_code', 'code', { ref: 'product_code' }),
      req('box_code', 'code', { ref: 'box_code' }),
      req('bunches_per_box', 'int', { min: 1 }),
      c('stems_per_box', 'int', { calculated: true }),
      c('est_gross_weight_kg', 'decimal', { min: 0 }),
    ],
    key: ['product_code', 'box_code'],
    example: { product_code: 'ROS-RN-A1-70', box_code: 'QB', bunches_per_box: 8, est_gross_weight_kg: 9.5 },
  },
  PriceList: {
    name: 'PriceList',
    description: 'Farm cost price per stem, with validity dates',
    columns: [
      req('farm_code', 'code', { ref: 'farm_code' }),
      req('product_code', 'code', { ref: 'product_code' }),
      req('currency', 'text', { list: 'Currency' }),
      req('price_per_stem', 'decimal', { min: 0 }),
      req('valid_from', 'date'),
      c('valid_to', 'date'),
      c('min_order_stems', 'int', { min: 1 }),
    ],
    key: ['farm_code', 'product_code', 'valid_from'],
    example: { farm_code: 'SIAN', product_code: 'ROS-RN-A1-70', price_per_stem: 0.25, valid_from: '2026-10-01' },
  },
  FreightRates: {
    name: 'FreightRates',
    description: 'Air freight rates per route',
    columns: [
      req('origin_airport', 'iata'),
      req('destination_airport', 'iata'),
      c('airline_or_agent', 'text'),
      req('currency', 'text', { list: 'Currency' }),
      req('rate_per_kg', 'decimal', { min: 0 }),
      c('min_charge', 'decimal', { min: 0 }),
      c('weight_break_kg', 'decimal', { min: 0 }),
      req('valid_from', 'date'),
      c('valid_to', 'date'),
    ],
    key: ['origin_airport', 'destination_airport', 'airline_or_agent', 'valid_from'],
    example: { origin_airport: 'NBO', destination_airport: 'AMS', airline_or_agent: 'Example Airline' },
  },
  PackingList: {
    name: 'PackingList',
    description: 'Boxes per shipment, farm and buyer',
    columns: [
      req('shipment_ref', 'code'),
      c('awb', 'awb'),
      c('hawb', 'text'),
      req('customer_code', 'code', { ref: 'customer_code' }),
      req('farm_code', 'code', { ref: 'farm_code' }),
      c('po_number', 'text'),
      req('product_code', 'code', { ref: 'product_code' }),
      req('box_code', 'code', { ref: 'box_code' }),
      req('boxes', 'int', { min: 1 }),
      c('bunches_per_box', 'int', { calculated: true }),
      c('total_stems', 'int', { calculated: true }),
      c('box_from', 'int', { calculated: true }),
      c('box_to', 'int', { calculated: true }),
      c('shipment_total_boxes', 'int', { calculated: true }),
      c('notes', 'text'),
    ],
    // Packing lines have no code of their own: a line is its position within the shipment.
    key: ['shipment_ref', 'line_no'],
    example: { shipment_ref: 'SHP-2026-0001', awb: '706-00000000', customer_code: 'FDAMS', farm_code: 'SIAN' },
  },
}

export function isSheetName(name: string): name is SheetName {
  return (SHEET_ORDER as readonly string[]).includes(name)
}

/** "farm_code *" -> "farm_code" */
export function normaliseHeader(raw: string) {
  return raw.replace(/\*/g, '').trim().toLowerCase().replace(/\s+/g, '_')
}
