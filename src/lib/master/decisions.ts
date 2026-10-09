/**
 * Decisions on the master file's farm names (from the review, 9 Oct 2026). Names are matched after the usual
 * spelling grouping in matchFarms(), so only one spelling of each needs listing.
 */

/** One farm, several names in the file: every name on the right becomes the name on the left. */
export const FARM_MERGES: Record<string, string[]> = {
  'Panocal International': ['Panocal', 'PANACOL'],
  'Heritage Flowers': ['Heritage'],
  'Florenza ltd': ['Florenza Flowers'],
  'Sierra Floral ltd': ['Sierra Flora ltd'],
}

/** One grower with farms in different places: each farm stays its own, under the grower's name. */
export const GROWERS: Record<string, string[]> = {
  'Eco Roses ltd': ['Eco Roses ltd ( BTG)', 'Eco Roses ltd Utee ( BTG)', 'Eco Roses ltd Salgaa ( BTG)'],
  Fontana: ['Fontana (Akina)', 'Fontana (Ayana)'],
  'Big Flowers': ['Big Flower (Diya)', 'Big Flowers'],
  'PJ Flowers': ['PJ Flowers', 'Pj Flora', 'PJ Dave Flora', 'Pj Timau (Rising Sun)'],
}

/** Placeholder names with no farm behind them: left out. */
export const LEAVE_OUT = (name: string) => /^farm\s*\d+$/i.test(name.trim())
