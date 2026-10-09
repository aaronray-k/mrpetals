export const MM_PER_PT = 25.4 / 72
export const PT_PER_MM = 72 / 25.4

export const DPI_OPTIONS = [203, 300] as const
export type Dpi = (typeof DPI_OPTIONS)[number]

export const dotsPerMm = (dpi: Dpi) => dpi / 25.4
export const mmToDots = (mm: number, dpi: Dpi) => Math.round(mm * dotsPerMm(dpi))
export const ptToMm = (pt: number) => pt * MM_PER_PT

/** Widest print area of a 4-inch label printer. */
export const FOUR_INCH_PRINT_WIDTH_MM = 104
