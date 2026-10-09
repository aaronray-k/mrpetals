/**
 * The ConsolFlora master price file ("Master DBase"): one sheet per flower group. Rose sheets have one row per
 * variety and farm, with a column per stem length in each block (USD and EUR farm prices, margins, pack rates);
 * Summer Flowers has one row per length. Calculated blocks (selling FOB, freight per stem, CIF, Madrid) are not
 * read: the app works them out from the inputs, so a changed freight rate flows through everything.
 *
 * Skipped: sheets with OFFER in the name, repeated header rows, and farms given only as a short code (XFL, SSL,
 * ABL/BVL...). "CONSOL - Afri" is the farm whose name starts with "Afri" (Africalla); if no farm matches, the
 * suffix is kept as the name.
 */
export interface RawSheet {
  sheet: string
  data: unknown[][]
}

export interface MasterRow {
  sheet: string
  /** Spreadsheet row number, as in Excel. */
  row: number
  category: string
  variety: string
  /** As typed in the sheet (trimmed). */
  farmRaw: string
  colour: string | null
  headSize: string | null
  lengthCm: number
  fobUsd: number | null
  fobEur: number | null
  /** ConsolFlora margin on FOB, per stem. */
  fobMargin: number | null
  /** ConsolFlora margin on CIF, per stem. */
  cifMargin: number | null
  stemsPerBox: number | null
  /** The standard box's weight for freight (volumetric), kg. */
  boxWeightKg: number | null
  boxName: string | null
  freightPerKg: number | null
  /** Trucking to Madrid: per box on the rose sheets, per stem on Summer Flowers. */
  truckingPerBox: number | null
  truckingPerStem: number | null
}

export interface FarmContact {
  farmRaw: string
  email: string | null
  phone: string | null
  location: string | null
  altitude: string | null
}

export interface SkippedRow {
  sheet: string
  row: number
  farmRaw: string
  reason: 'code' | 'no farm' | 'no price'
}

export interface MasterFile {
  rows: MasterRow[]
  contacts: FarmContact[]
  skipped: SkippedRow[]
  sheets: { name: string; read: boolean; rows: number }[]
}

const text = (v: unknown): string | null => {
  if (v == null) return null
  const t = String(v).replace(/\s+/g, ' ').trim()
  return t === '' ? null : t
}
const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const t = text(v)
  if (!t) return null
  const n = Number(t.replace(/[^0-9.\-]/g, ''))
  return t.match(/\d/) && Number.isFinite(n) ? n : null
}
const lengthOf = (v: unknown): number | null => {
  const m = text(v)?.match(/(\d{2,3})\s*c?c?m/i)
  return m ? Number(m[1]) : null
}
const has = (v: unknown, re: RegExp) => re.test(text(v) ?? '')

/** "XFL", "ABL/ BVL", "SSL/XFL": a farm given only by its short code. */
export function isFarmCode(name: string): boolean {
  const parts = name.split('/').map((p) => p.trim()).filter(Boolean)
  return parts.length > 0 && parts.every((p) => /^[A-Z]{2,4}$/.test(p))
}

/** "CONSOL - Afri" → "Afri"; null when the name has no CONSOL prefix. */
export function consolSuffix(name: string): string | null {
  const m = name.match(/^consol\b\s*-?\s*(.+)$/i)
  return m ? m[1]!.trim() : null
}

/** For grouping spellings of one farm: "Ever Flora" and "Everflora ltd" → "everflora". */
export function farmKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(\s*btg\s*\)/g, '')
    .replace(/\b(ltd|limited|plc|co)\b\.?/g, '')
    .replace(/[^a-z0-9]/g, '')
}

export function parseMasterWorkbook(sheets: RawSheet[]): MasterFile {
  const out: MasterFile = { rows: [], contacts: [], skipped: [], sheets: [] }
  for (const s of sheets) {
    const name = s.sheet.trim()
    if (/offer/i.test(name)) {
      out.sheets.push({ name, read: false, rows: 0 })
      continue
    }
    const before = out.rows.length
    const headerIdx = s.data.findIndex((r) => (r ?? []).some((v) => /^variety$/i.test(text(v) ?? '')))
    if (headerIdx < 1) {
      out.sheets.push({ name, read: false, rows: 0 })
      continue
    }
    const header = s.data[headerIdx] ?? []
    const titles = s.data[headerIdx - 1] ?? []
    if (header.some((v) => /^length$/i.test(text(v) ?? ''))) readPerLength(s, headerIdx, header, titles, out)
    else readPerVariety(s, headerIdx, header, titles, out)
    out.sheets.push({ name, read: true, rows: out.rows.length - before })
  }
  return out
}

/** Column index of each block's title in the row above the headers, in order. */
function blocks(titles: unknown[]) {
  const starts: { col: number; title: string }[] = []
  titles.forEach((v, col) => {
    const t = text(v)
    if (t) starts.push({ col, title: t })
  })
  return starts
}

function farmOf(v: unknown): string | null {
  const t = text(v)
  if (!t || /^farms?$/i.test(t)) return null
  return t
}

function readPerVariety(s: RawSheet, headerIdx: number, header: unknown[], titles: unknown[], out: MasterFile) {
  const col = (re: RegExp) => header.findIndex((v) => re.test(text(v) ?? ''))
  const cCat = col(/^category$/i)
  const cVar = col(/^variety$/i)
  const cFarm = col(/^farm/i)
  const cColour = col(/^(colou?r|scent)$/i)
  const cHead = col(/^head size$/i)
  const bl = blocks(titles)
  // A block's length columns: from its title up to the next block's title.
  const span = (re: RegExp, nth = 0) => {
    const i = bl.map((b, k) => ({ ...b, k })).filter((b) => re.test(b.title))[nth]
    if (!i) return [] as { col: number; len: number }[]
    const end = bl[i.k + 1]?.col ?? header.length
    const cols: { col: number; len: number }[] = []
    for (let c = i.col; c < end; c++) {
      const len = lengthOf(header[c])
      if (len) cols.push({ col: c, len })
    }
    return cols
  }
  const usd = span(/usd/i)
  const eur = span(/eur/i)
  const fobMargin = span(/margin/i, 0)
  const pack = span(/pack ?rate/i)
  const cifMargin = span(/margin/i, 1)
  const trucking = span(/trucking/i)
  const vWeight = bl.find((b) => /v\. ?weight/i.test(b.title))?.col ?? -1
  const perKg = header.findIndex((v) => /^per kg$/i.test(text(v) ?? ''))
  const cEmail = titles.findIndex((v) => /email/i.test(text(v) ?? ''))
  // Lengths: the farm price columns (USD, else EUR); other blocks are matched by position.
  const lengths = (usd.length ? usd : eur).map((c) => c.len)
  const at = (blk: { col: number; len: number }[], i: number, r: unknown[]) => (blk[i] ? num(r[blk[i]!.col]) : null)

  for (let i = headerIdx + 1; i < s.data.length; i++) {
    const r = s.data[i] ?? []
    const variety = text(r[cVar])
    const farmRaw = farmOf(r[cFarm])
    if (!variety || /^variety$/i.test(variety)) continue
    if (!farmRaw) {
      out.skipped.push({ sheet: s.sheet.trim(), row: i + 1, farmRaw: '', reason: 'no farm' })
      continue
    }
    if (isFarmCode(consolSuffix(farmRaw) ?? farmRaw)) {
      out.skipped.push({ sheet: s.sheet.trim(), row: i + 1, farmRaw, reason: 'code' })
      continue
    }
    if (cEmail >= 0 && (text(r[cEmail]) || text(r[cEmail + 1])))
      out.contacts.push({ farmRaw, email: text(r[cEmail]), phone: text(r[cEmail + 1]), location: text(r[cEmail + 2]), altitude: text(r[cEmail + 3]) })
    let any = false
    lengths.forEach((len, k) => {
      const fobUsd = at(usd, k, r)
      const fobEur = at(eur, k, r)
      // 0 or blank: this length isn't offered.
      if (!fobUsd && !fobEur) return
      const stems = at(pack, k, r)
      const truck = at(trucking, k, r)
      any = true
      out.rows.push({
        sheet: s.sheet.trim(),
        row: i + 1,
        category: text(r[cCat]) ?? s.sheet.trim(),
        variety,
        farmRaw,
        colour: cColour >= 0 ? text(r[cColour]) : null,
        headSize: cHead >= 0 ? text(r[cHead]) : null,
        lengthCm: len,
        fobUsd: fobUsd || null,
        fobEur: fobEur || null,
        fobMargin: at(fobMargin, k, r),
        cifMargin: at(cifMargin, k, r),
        stemsPerBox: stems || null,
        boxWeightKg: vWeight >= 0 ? num(r[vWeight]) : null,
        boxName: vWeight >= 0 ? text(r[vWeight + 1]) : null,
        freightPerKg: perKg >= 0 ? num(r[perKg]) : null,
        // The sheet divides a per-box trucking charge by the pack rate: turn it back into the per-box figure.
        truckingPerBox: truck && stems ? Math.round(truck * stems * 100) / 100 : null,
        truckingPerStem: null,
      })
    })
    if (!any) out.skipped.push({ sheet: s.sheet.trim(), row: i + 1, farmRaw, reason: 'no price' })
  }
}

function readPerLength(s: RawSheet, headerIdx: number, header: unknown[], titles: unknown[], out: MasterFile) {
  const col = (re: RegExp, from = 0) => header.findIndex((v, i) => i >= from && re.test(text(v) ?? ''))
  const tcol = (re: RegExp, nth = 0) => titles.map((v, i) => (re.test(text(v) ?? '') ? i : -1)).filter((i) => i >= 0)[nth] ?? -1
  const cFarm = col(/^farms?$/i)
  const cCat = col(/^product$/i)
  const cVar = col(/^variety$/i)
  const cColour = col(/^colou?r/i)
  const cLen = col(/^length$/i)
  const cUsd = col(/^usd$/i)
  const cEur = col(/^euro?$/i)
  const cFobMargin = tcol(/margin/i, 0)
  const cCifMargin = tcol(/margin/i, 1)
  const cPack = tcol(/pack ?rate/i)
  const cWeight = tcol(/v\. ?weight/i)
  const cPerKg = col(/^per kg$/i)
  // "TRUCKING MADRID" sits in the block-title row above; its figures are in that column.
  const titlesAbove = s.data[headerIdx - 2] ?? []
  const cTruck = titlesAbove.findIndex((v) => /trucking/i.test(text(v) ?? ''))

  for (let i = headerIdx + 1; i < s.data.length; i++) {
    const r = s.data[i] ?? []
    const variety = text(r[cVar])
    const farmRaw = farmOf(r[cFarm])
    if (!variety) continue
    if (!farmRaw) {
      out.skipped.push({ sheet: s.sheet.trim(), row: i + 1, farmRaw: '', reason: 'no farm' })
      continue
    }
    if (isFarmCode(consolSuffix(farmRaw) ?? farmRaw)) {
      out.skipped.push({ sheet: s.sheet.trim(), row: i + 1, farmRaw, reason: 'code' })
      continue
    }
    const len = lengthOf(r[cLen])
    const fobUsd = num(r[cUsd])
    const fobEur = num(r[cEur])
    if (!len || (!fobUsd && !fobEur)) {
      out.skipped.push({ sheet: s.sheet.trim(), row: i + 1, farmRaw, reason: 'no price' })
      continue
    }
    out.rows.push({
      sheet: s.sheet.trim(),
      row: i + 1,
      category: text(r[cCat]) ?? s.sheet.trim(),
      variety,
      farmRaw,
      colour: text(r[cColour]),
      headSize: null,
      lengthCm: len,
      fobUsd: fobUsd || null,
      fobEur: fobEur || null,
      fobMargin: cFobMargin >= 0 ? num(r[cFobMargin]) : null,
      cifMargin: cCifMargin >= 0 ? num(r[cCifMargin]) : null,
      stemsPerBox: cPack >= 0 ? num(r[cPack]) || null : null,
      boxWeightKg: cWeight >= 0 ? num(r[cWeight]) : null,
      boxName: null,
      freightPerKg: cPerKg >= 0 ? num(r[cPerKg]) : null,
      truckingPerBox: null,
      truckingPerStem: cTruck >= 0 ? num(r[cTruck]) : null,
    })
  }
}

export interface FarmMatch {
  /** The name the farm gets in ConsolFlora. */
  name: string
  /** How it was found: as typed, CONSOL suffix matched to a full name, or CONSOL suffix kept. */
  how: 'name' | 'consol matched' | 'consol suffix'
  spellings: string[]
  rows: number
}

/**
 * Groups the farm names in the file: spellings of one farm together ("Ever Flora", "Everflora"), and each
 * "CONSOL - x" with the farm whose name starts with x, if exactly one does.
 */
export function matchFarms(rows: Pick<MasterRow, 'farmRaw'>[]): { farms: FarmMatch[]; byRaw: Map<string, string> } {
  const count = new Map<string, number>()
  for (const r of rows) count.set(r.farmRaw, (count.get(r.farmRaw) ?? 0) + 1)
  const groups = new Map<string, { spellings: Set<string>; rows: number }>()
  const consol: string[] = []
  for (const [raw, n] of count) {
    if (consolSuffix(raw) != null) {
      consol.push(raw)
      continue
    }
    const k = farmKey(raw)
    const g = groups.get(k) ?? { spellings: new Set<string>(), rows: 0 }
    g.spellings.add(raw)
    g.rows += n
    groups.set(k, g)
  }
  // The display name: the most used spelling, the longer one on a tie.
  const pick = (sp: Set<string>) => [...sp].sort((a, b) => (count.get(b) ?? 0) - (count.get(a) ?? 0) || b.length - a.length)[0]!
  const farms = new Map<string, FarmMatch>()
  const byRaw = new Map<string, string>()
  for (const g of groups.values()) {
    const name = pick(g.spellings)
    farms.set(name, { name, how: 'name', spellings: [...g.spellings].sort(), rows: g.rows })
    for (const s of g.spellings) byRaw.set(s, name)
  }
  const named = [...farms.keys()]
  for (const raw of consol) {
    const suffix = consolSuffix(raw)!
    const k = farmKey(suffix)
    const hits = named.filter((n) => farmKey(n).startsWith(k))
    const name = hits.length === 1 ? hits[0]! : suffix
    const f = farms.get(name) ?? { name, how: hits.length === 1 ? ('consol matched' as const) : ('consol suffix' as const), spellings: [], rows: 0 }
    if (hits.length === 1 && f.how === 'name') f.how = 'consol matched'
    f.spellings.push(raw)
    f.rows += count.get(raw) ?? 0
    farms.set(name, f)
    byRaw.set(raw, name)
  }
  return { farms: [...farms.values()].sort((a, b) => a.name.localeCompare(b.name)), byRaw }
}


// Summer flowers: the many spellings in the file, to one flower name. Checked in order; first match wins.
const FLOWER_NAMES: [RegExp, string][] = [
  [/alst/i, 'Alstroemeria'],
  [/ammi/i, 'Ammi Visnaga'],
  [/anigozanthos|kangaroo/i, 'Kangaroo Paw'],
  [/asclepia|tuberose/i, 'Tuberose'],
  [/asiatic/i, 'Asiatic Lily'],
  [/oriental/i, 'Oriental Lily'],
  [/calla|arum/i, 'Calla Lily'],
  [/^asters?$/i, 'Aster'],
  [/bu?ph?u?l?e?u?rum|buplerum/i, 'Bupleurum'],
  [/c[a]?r?thamus/i, 'Carthamus'],
  [/santini|satini/i, 'Chrysanthemum Santini'],
  [/spray chrys/i, 'Spray Chrysanthemum'],
  [/chrys/i, 'Standard Chrysanthemum'],
  [/craspedia/i, 'Craspedia'],
  [/delphinium/i, 'Delphinium'],
  [/dianthus/i, 'Dianthus'],
  [/spray carnation/i, 'Spray Carnation'],
  [/carnation/i, 'Standard Carnation'],
  [/er[uy]n?gium/i, 'Eryngium'],
  [/gyps/i, 'Gypsophila'],
  [/hydra?n?gea/i, 'Hydrangea'],
  [/hypericum/i, 'Hypericum'],
  [/lisianthus|lysianthus|lianthrus/i, 'Lisianthus'],
  [/limonium|statice/i, 'Limonium'],
  [/ornit|ornis/i, 'Ornithogalum'],
  [/ph?lox/i, 'Phlox'],
  [/gerbera/i, 'Gerbera'],
  [/agap/i, 'Agapanthus'],
  [/mathiola|matthiola/i, 'Matthiola'],
  [/molucella|mollucella/i, 'Moluccella'],
  [/leather fern/i, 'Leather Fern'],
]

/** What the webshop calls the flower, and its grade (roses), from the sheet and the Category column. */
export function flowerTypeOf(sheet: string, category: string): { flowerType: string; grade: string | null } {
  const cat = category.replace(/\s+/g, ' ').trim()
  if (/summer/i.test(sheet)) {
    const hit = FLOWER_NAMES.find(([re]) => re.test(cat))
    const name = hit ? hit[1] : cat.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/s$/, '')
    return { flowerType: name, grade: null }
  }
  const c = cat.toLowerCase()
  const spray = /spray|spary/.test(c) || (/spray/i.test(sheet) && !/garden/.test(c))
  const grade = /david austin/.test(c)
    ? 'David Austin'
    : /platinum/.test(c)
      ? 'Platinum'
      : /novel|noval/.test(c)
        ? 'Novelty'
        : /special premium/.test(c)
          ? 'Special Premium'
          : /mid.?premium/.test(c)
            ? 'Mid Premium'
            : /super intermediate/.test(c)
              ? 'Super Intermediate'
              : /intermediate/.test(c)
                ? 'Intermediate'
                : /premium/.test(c)
                  ? 'Premium'
                  : /re[gq]ular/.test(c)
                    ? 'Regular'
                    : /garden|scented/.test(c)
                      ? 'Garden'
                      : spray
                        ? 'Regular'
                        : 'Premium'
  const flowerType = spray ? 'Spray Rose' : /garden|scented|david austin/.test(c) ? 'Garden Rose' : 'Rose'
  return { flowerType, grade }
}

/** For the webshop: one entry per flower and variety, whoever grows it. "Pink Athena " and "pink athena" are one. */
export function varietyKeyOf(flowerType: string, variety: string) {
  return `${flowerType.toLowerCase()}|${variety.toLowerCase().replace(/[^a-z0-9]/g, '')}`
}

/** Letters only, for matching catalogue photo names to varieties. */
export const nameKey = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '')

/** Small spelling slips ("Confidendtial") still match: edit distance, for names of 6+ letters. */
export function nearlySame(a: string, b: string) {
  if (a === b) return true
  if (Math.min(a.length, b.length) < 6 || Math.abs(a.length - b.length) > 2) return false
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0]![j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length]![b.length]! <= (a.length >= 10 ? 2 : 1)
}
