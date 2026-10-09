import { describe, expect, it } from 'vitest'
import { flushQueue, memoryStore, type QueueItem } from './queue'

const item = (id: string, at: string): QueueItem => ({ id, kind: 'scan', createdAt: at, payload: {}, label: id })

describe('QC queue', () => {
  it('sends oldest first and stops when the connection is gone', async () => {
    const store = memoryStore()
    await store.put(item('b', '2026-08-02T10:00:02Z'))
    await store.put(item('a', '2026-08-02T10:00:01Z'))
    await store.put(item('c', '2026-08-02T10:00:03Z'))
    const seen: string[] = []
    const r = await flushQueue(store, async (i) => {
      seen.push(i.id)
      return i.id === 'b' ? { status: 'retry' } : { status: 'sent' }
    })
    expect(seen).toEqual(['a', 'b'])
    expect(r).toEqual({ sent: 1, refused: [], waiting: 2 })
  })

  it('drops refused items and reports why', async () => {
    const store = memoryStore()
    await store.put(item('a', '1'))
    await store.put(item('b', '2'))
    const r = await flushQueue(store, async (i) => (i.id === 'a' ? { status: 'refused', message: 'Box 1 belongs to shipment X' } : { status: 'sent' }))
    expect(r.sent).toBe(1)
    expect(r.refused.map((x) => x.message)).toEqual(['Box 1 belongs to shipment X'])
    expect(r.waiting).toBe(0)
  })
})
