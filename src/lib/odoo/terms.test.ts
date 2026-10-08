import { describe, expect, it } from 'vitest'
import { suggestedDueDate } from './terms'

describe('suggested due date for a manual invoice', () => {
  const today = new Date('2026-10-31T09:00:00Z')
  it('15th of following month, Net N, Prepaid; other terms are left to Odoo', () => {
    expect(suggestedDueDate('15th of following month', today)).toBe('2026-11-15')
    expect(suggestedDueDate('15th of following month', new Date('2026-12-02T09:00:00Z'))).toBe('2027-01-15')
    expect(suggestedDueDate('Net 30', today)).toBe('2026-11-30')
    expect(suggestedDueDate('Prepaid', today)).toBe('2026-10-31')
    expect(suggestedDueDate('Cash on delivery', today)).toBe('')
  })
})
