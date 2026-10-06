/** Everything a box label can show. Filled from the box, its packing line and shipment when printing (item 3). */
export interface LabelData {
  boxId: number
  /** Position in the shipment: box 42 of 180. */
  boxNo: number
  boxTotal: number
  /** Position among this farm's boxes in the shipment: farm box 3 of 12. */
  farmBoxNo: number
  farmBoxTotal: number
  shipmentRef: string
  mawb: string | null
  hawb: string | null
  poNumber: string | null
  customerCode: string
  customerName: string
  destinationAirport: string
  destinationCountry: string
  farmCode: string
  farmName: string
  originCountry: string
  originAirport: string | null
  productCode: string
  flowerType: string
  variety: string
  colour: string | null
  grade: string
  stemLengthCm: number
  headSizeCm: number | null
  maturity: string | null
  vbnCode: string | null
  stemsPerBunch: number
  bunchesPerBox: number
  stemsPerBox: number
  boxCode: string
  boxDescription: string | null
  grossWeightKg: number | null
  /** YYYY-MM-DD */
  packDate: string
}

/** Made-up box used for the designer preview and test prints. */
export const SAMPLE_LABEL_DATA: LabelData = {
  boxId: 10042,
  boxNo: 42,
  boxTotal: 180,
  farmBoxNo: 3,
  farmBoxTotal: 12,
  shipmentRef: 'SHP-2026-0001',
  mawb: '706-12345675',
  hawb: 'HAWB-0042',
  poNumber: 'PO-2026-0001',
  customerCode: 'FDAMS',
  customerName: 'Example Flowers BV',
  destinationAirport: 'AMS',
  destinationCountry: 'Netherlands',
  farmCode: 'KIBO',
  farmName: 'Kibo Roses Ltd',
  originCountry: 'Kenya',
  originAirport: 'NBO',
  productCode: 'ROS-RN-A1-70',
  flowerType: 'Rose',
  variety: 'Red Naomi',
  colour: 'Red',
  grade: 'A1',
  stemLengthCm: 70,
  headSizeCm: 5.5,
  maturity: 'Stage 2',
  vbnCode: '123456',
  stemsPerBunch: 10,
  bunchesPerBox: 8,
  stemsPerBox: 80,
  boxCode: 'QB',
  boxDescription: 'Quarter box',
  grossWeightKg: 9.5,
  packDate: '2026-10-06',
}

/** How the box id is printed. Box ids come from a database sequence and are never reused. */
export function formatBoxId(id: number) {
  return String(id).padStart(8, '0')
}
