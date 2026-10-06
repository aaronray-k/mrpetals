/**
 * Scans, results and photos waiting to be sent, kept on the phone so a dropped connection loses
 * nothing (they survive a page reload). Each item has an id made on the phone, which the database
 * uses to record it once however often it is sent.
 */

export type QueueKind = 'scan' | 'result' | 'photo'

export interface QueueItem {
  id: string
  kind: QueueKind
  createdAt: string
  /** What to send; for a photo, the file is in `blob`. */
  payload: Record<string, unknown>
  blob?: Blob
  /** Shown to QC while it waits, e.g. "Box 10000042". */
  label: string
}

export interface QueueStore {
  all(): Promise<QueueItem[]>
  put(item: QueueItem): Promise<void>
  remove(id: string): Promise<void>
}

/** Outcome of sending one item. "retry": no connection, keep it. "refused": the database said no. */
export type SendOutcome = { status: 'sent' } | { status: 'retry' } | { status: 'refused'; message: string }

export function memoryStore(): QueueStore {
  const items = new Map<string, QueueItem>()
  return {
    all: async () => [...items.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    put: async (item) => void items.set(item.id, item),
    remove: async (id) => void items.delete(id),
  }
}

const DB = 'consolflora-qc'
const STORE = 'queue'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode)
        const req = run(t.objectStore(STORE))
        t.oncomplete = () => {
          db.close()
          resolve(req.result)
        }
        t.onerror = () => reject(t.error)
      }),
  )
}

/** IndexedDB on the phone; falls back to memory where the browser blocks it. */
export function browserStore(): QueueStore {
  if (typeof indexedDB === 'undefined') return memoryStore()
  const fallback = memoryStore()
  let broken = false
  const guard = async <T>(fn: () => Promise<T>, alt: () => Promise<T>) => {
    if (broken) return alt()
    try {
      return await fn()
    } catch {
      broken = true
      return alt()
    }
  }
  return {
    all: () =>
      guard(
        async () => ((await tx('readonly', (s) => s.getAll())) as QueueItem[]).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
        () => fallback.all(),
      ),
    put: (item) => guard(async () => void (await tx('readwrite', (s) => s.put(item))), () => fallback.put(item)),
    remove: (id) => guard(async () => void (await tx('readwrite', (s) => s.delete(id))), () => fallback.remove(id)),
  }
}

/**
 * Sends waiting items oldest first. Stops at the first one that can't go yet (no connection), so
 * order is kept. Refused items are removed and returned so QC can see why.
 */
export async function flushQueue(store: QueueStore, send: (item: QueueItem) => Promise<SendOutcome>) {
  const refused: { item: QueueItem; message: string }[] = []
  let sent = 0
  for (const item of await store.all()) {
    const outcome = await send(item)
    if (outcome.status === 'retry') break
    await store.remove(item.id)
    if (outcome.status === 'refused') refused.push({ item, message: outcome.message })
    else sent++
  }
  return { sent, refused, waiting: (await store.all()).length }
}
