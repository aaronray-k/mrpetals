import { FARM_MERGES, GROWERS, LEAVE_OUT } from './decisions'
import { flowerTypeOf, matchFarms, nameKey, nearlySame, varietyKeyOf, type MasterFile } from './parse'

/** A catalogue photo, as listed in public/catalogue/index.json. */
export interface CataloguePhoto {
  name: string
  file: string
  page: number
}

export interface PlanFarm {
  name: string
  grower: string | null
  spellings: string[]
  email: string | null
  phone: string | null
  location: string | null
  altitude: string | null
  /** The currency most of its prices are in. */
  currency: string
}
export interface PlanVariety {
  key: string
  flowerType: string
  name: string
  grade: string | null
  colour: string | null
  photo: string | null
  spellings: string[]
  growers: string[]
}
export interface PlanOffer {
  farm: string
  variety: string
  lengthCm: number
  headSizeCm: number | null
  currency: 'USD' | 'EUR'
  price: number
  fobMargin: number | null
  cifMargin: number | null
  stemsPerBox: number | null
  boxWeightKg: number | null
  truckingPerBox: number | null
  truckingPerStem: number | null
}
export interface ImportPlan {
  farms: PlanFarm[]
  varieties: PlanVariety[]
  offers: PlanOffer[]
  /** The freight rate per kg the file used most. */
  fileFreightPerKg: number | null
  counts: { prices: number; duplicates: number; leftOut: number; skipped: number; withPhoto: number }
}

// The catalogue's sections, by page: a photo only goes with varieties of its kind.
const section = (page: number) => (page <= 16 ? 'rose' : page <= 23 ? 'spray' : 'other')
const kindOf = (t: string) => (t === 'Spray Rose' ? 'spray' : t === 'Rose' || t === 'Garden Rose' ? 'rose' : 'other')
const mostCommon = <T,>(xs: T[]): T | null => {
  const n = new Map<T, number>()
  for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1)
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}
const headCm = (s: string | null) => {
  const m = s?.match(/(\d+(?:\.\d+)?)/)
  return m ? Number(m[1]) : null
}

/** What the import saves: farms (merges and growers applied), one webshop variety per flower and name, and prices. */
export function importPlan(file: MasterFile, catalogue: CataloguePhoto[]): ImportPlan {
  const { farms: matched, byRaw } = matchFarms(file.rows)
  const mergedName = new Map<string, string>()
  for (const [to, from] of Object.entries(FARM_MERGES)) for (const f of from) mergedName.set(f, to)
  const farmOf = (raw: string) => {
    const n = byRaw.get(raw) ?? raw
    return mergedName.get(n) ?? n
  }
  const growerOf = new Map<string, string>()
  for (const [g, fs] of Object.entries(GROWERS)) for (const f of fs) growerOf.set(f, g)

  // Varieties: spellings with the same catalogue photo are one, under the catalogue's name.
  const photos = catalogue.map((c) => ({ ...c, k: nameKey(c.name), section: section(c.page) }))
  const photoFor = (flowerType: string, variety: string) => {
    const own = photos.filter((p) => p.section === kindOf(flowerType))
    const k = nameKey(variety)
    return (
      own.find((p) => p.k === k) ??
      own.find((p) => p.k === nameKey(flowerType + variety) || p.k === nameKey(variety + flowerType)) ??
      own.find((p) => nearlySame(p.k, k)) ??
      null
    )
  }
  const rows = file.rows.filter((r) => !LEAVE_OUT(farmOf(r.farmRaw)))
  const leftOut = file.rows.length - rows.length
  type Acc = { flowerType: string; photo: CataloguePhoto | null; spellings: string[]; grades: string[]; colours: string[]; growers: Set<string> }
  const acc = new Map<string, Acc>()
  const keyOfRow = new Map<number, string>()
  rows.forEach((r, i) => {
    const { flowerType, grade } = flowerTypeOf(r.sheet, r.category)
    const photo = photoFor(flowerType, r.variety)
    const key = photo ? `${flowerType.toLowerCase()}|photo:${photo.file}` : varietyKeyOf(flowerType, r.variety)
    const a = acc.get(key) ?? { flowerType, photo, spellings: [], grades: [], colours: [], growers: new Set<string>() }
    a.spellings.push(r.variety)
    if (grade) a.grades.push(grade)
    if (r.colour) a.colours.push(r.colour)
    a.growers.add(farmOf(r.farmRaw))
    acc.set(key, a)
    keyOfRow.set(i, key)
  })
  const varieties: PlanVariety[] = [...acc].map(([key, a]) => ({
    key,
    flowerType: a.flowerType,
    name: a.photo?.name ?? mostCommon(a.spellings)!,
    grade: mostCommon(a.grades),
    colour: mostCommon(a.colours),
    photo: a.photo?.file ?? null,
    spellings: [...new Set(a.spellings)].sort(),
    growers: [...a.growers].sort(),
  }))

  // Prices: one per farm, variety and length (the first row wins if the file repeats one).
  const offers: PlanOffer[] = []
  const seen = new Set<string>()
  let duplicates = 0
  rows.forEach((r, i) => {
    const farm = farmOf(r.farmRaw)
    const variety = keyOfRow.get(i)!
    const k = `${farm}|${variety}|${r.lengthCm}`
    if (seen.has(k)) {
      duplicates++
      return
    }
    seen.add(k)
    const usd = r.fobUsd != null && r.fobUsd > 0
    offers.push({
      farm,
      variety,
      lengthCm: r.lengthCm,
      headSizeCm: headCm(r.headSize),
      currency: usd ? 'USD' : 'EUR',
      price: (usd ? r.fobUsd : r.fobEur)!,
      fobMargin: r.fobMargin,
      cifMargin: r.cifMargin,
      stemsPerBox: r.stemsPerBox,
      boxWeightKg: r.boxWeightKg,
      truckingPerBox: r.truckingPerBox,
      truckingPerStem: r.truckingPerStem,
    })
  })

  const contacts = new Map<string, (typeof file.contacts)[number]>()
  for (const c of file.contacts) if (!contacts.has(farmOf(c.farmRaw))) contacts.set(farmOf(c.farmRaw), c)
  const farmNames = [...new Set(offers.map((o) => o.farm))].sort()
  const farms: PlanFarm[] = farmNames.map((name) => {
    const c = contacts.get(name)
    return {
      name,
      grower: growerOf.get(name) ?? null,
      spellings: [...new Set(matched.filter((m) => farmOf(m.spellings[0] ?? m.name) === name).flatMap((m) => m.spellings))].sort(),
      email: c?.email ?? null,
      phone: c?.phone ?? null,
      location: c?.location ?? null,
      altitude: c?.altitude ?? null,
      currency: mostCommon(offers.filter((o) => o.farm === name).map((o) => o.currency)) ?? 'USD',
    }
  })
  return {
    farms,
    varieties,
    offers,
    fileFreightPerKg: mostCommon(rows.map((r) => r.freightPerKg).filter((x): x is number => x != null)),
    counts: { prices: offers.length, duplicates, leftOut, skipped: file.skipped.length, withPhoto: varieties.filter((v) => v.photo).length },
  }
}
