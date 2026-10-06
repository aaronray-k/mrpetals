import type { LabelData } from './data'

export const FIELD_GROUPS = ['Product', 'Box', 'Shipment', 'Buyer', 'Farm'] as const
export type FieldGroup = (typeof FIELD_GROUPS)[number]

export interface FieldDef {
  key: string
  group: FieldGroup
  /** Caption in English and Dutch, printed before the value when the element asks for one. */
  en: string
  nl: string
  value: (d: LabelData) => string
}

const num = (n: number | null, unit = '') => (n == null ? '' : `${n}${unit}`)
const text = (s: string | null) => s ?? ''

/** Fields an Admin can place on a label. Add new ones here; the designer picks them up automatically. */
export const LABEL_FIELDS = [
  { key: 'variety', group: 'Product', en: 'Variety', nl: 'Ras', value: (d) => d.variety },
  { key: 'flower_type', group: 'Product', en: 'Flower', nl: 'Bloem', value: (d) => d.flowerType },
  { key: 'colour', group: 'Product', en: 'Colour', nl: 'Kleur', value: (d) => text(d.colour) },
  { key: 'grade', group: 'Product', en: 'Grade', nl: 'Kwaliteit', value: (d) => d.grade },
  { key: 'stem_length', group: 'Product', en: 'Length', nl: 'Lengte', value: (d) => num(d.stemLengthCm, ' cm') },
  { key: 'head_size', group: 'Product', en: 'Head size', nl: 'Knopmaat', value: (d) => num(d.headSizeCm, ' cm') },
  { key: 'maturity', group: 'Product', en: 'Maturity', nl: 'Rijpheid', value: (d) => text(d.maturity) },
  { key: 'product_code', group: 'Product', en: 'Product', nl: 'Product', value: (d) => d.productCode },
  { key: 'vbn_code', group: 'Product', en: 'VBN code', nl: 'VBN-code', value: (d) => text(d.vbnCode) },
  { key: 'stems_per_bunch', group: 'Product', en: 'Stems per bunch', nl: 'Stelen per bos', value: (d) => num(d.stemsPerBunch) },
  { key: 'bunches_per_box', group: 'Product', en: 'Bunches per box', nl: 'Bossen per doos', value: (d) => num(d.bunchesPerBox) },
  { key: 'stems_per_box', group: 'Product', en: 'Stems per box', nl: 'Stelen per doos', value: (d) => num(d.stemsPerBox) },
  { key: 'farm_box_count', group: 'Box', en: 'Farm box', nl: 'Kwekersdoos', value: (d) => `${d.farmBoxNo} / ${d.farmBoxTotal}` },
  { key: 'box_type', group: 'Box', en: 'Box type', nl: 'Doostype', value: (d) => d.boxCode },
  { key: 'gross_weight', group: 'Box', en: 'Gross weight', nl: 'Brutogewicht', value: (d) => num(d.grossWeightKg, ' kg') },
  { key: 'pack_date', group: 'Box', en: 'Packed', nl: 'Verpakt', value: (d) => d.packDate },
  { key: 'shipment_ref', group: 'Shipment', en: 'Shipment', nl: 'Zending', value: (d) => d.shipmentRef },
  { key: 'mawb', group: 'Shipment', en: 'AWB', nl: 'AWB', value: (d) => text(d.mawb) },
  { key: 'hawb', group: 'Shipment', en: 'HAWB', nl: 'HAWB', value: (d) => text(d.hawb) },
  { key: 'po_number', group: 'Shipment', en: 'PO number', nl: 'Ordernummer', value: (d) => text(d.poNumber) },
  { key: 'origin_airport', group: 'Shipment', en: 'From', nl: 'Van', value: (d) => text(d.originAirport) },
  { key: 'destination_airport', group: 'Shipment', en: 'Destination', nl: 'Bestemming', value: (d) => d.destinationAirport },
  { key: 'customer_name', group: 'Buyer', en: 'Buyer', nl: 'Klant', value: (d) => d.customerName },
  { key: 'customer_code', group: 'Buyer', en: 'Buyer code', nl: 'Klantcode', value: (d) => d.customerCode },
  { key: 'destination_country', group: 'Buyer', en: 'Country', nl: 'Land', value: (d) => d.destinationCountry },
  { key: 'farm_name', group: 'Farm', en: 'Grower', nl: 'Kweker', value: (d) => d.farmName },
  { key: 'farm_code', group: 'Farm', en: 'Grower code', nl: 'Kwekerscode', value: (d) => d.farmCode },
  { key: 'origin_country', group: 'Farm', en: 'Origin', nl: 'Herkomst', value: (d) => d.originCountry },
] as const satisfies readonly FieldDef[]

export type FieldKey = (typeof LABEL_FIELDS)[number]['key']

const BY_KEY = new Map<string, FieldDef>(LABEL_FIELDS.map((f) => [f.key, f]))

export function fieldDef(key: string): FieldDef | undefined {
  return BY_KEY.get(key)
}

export function isFieldKey(key: string): key is FieldKey {
  return BY_KEY.has(key)
}
