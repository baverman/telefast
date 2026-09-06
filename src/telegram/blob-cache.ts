const DATABASE_VERSION = 1
const CLEANUP_INTERVAL = 10 * 60_000
const ACCESS_UPDATE_INTERVAL = 60 * 60_000
const MAX_ENTRY_AGE = 3 * 24 * 60 * 60_000

interface MediaAccess {
  lastAccessed: number
}

export interface BlobCache {
  get(key: string): Promise<Blob | undefined>
  put(key: string, blob: Blob): Promise<void>
  clean(): Promise<void>
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true })
    request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB request failed')), { once: true })
  })
}

function transactionComplete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true })
    transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('IndexedDB transaction aborted')), { once: true })
    transaction.addEventListener('error', () => reject(transaction.error ?? new Error('IndexedDB transaction failed')), { once: true })
  })
}

export function openBlobCache(accountId: string): BlobCache {
  let lastCleanup = Date.now()
  let databasePromise: Promise<IDBDatabase> | null = null

  function database() {
    if (!databasePromise) {
      databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(`cache-${accountId}`, DATABASE_VERSION)
        request.addEventListener('upgradeneeded', () => {
          const db = request.result
          db.createObjectStore('blobs')
          const access = db.createObjectStore('access')
          access.createIndex('lastAccessed', 'lastAccessed')
        })
        request.addEventListener('success', () => {
          request.result.addEventListener('versionchange', () => request.result.close())
          resolve(request.result)
        }, { once: true })
        request.addEventListener('error', () => reject(request.error ?? new Error('Failed to open blob cache')), { once: true })
        request.addEventListener('blocked', () => reject(new Error('Opening blob cache was blocked')), { once: true })
      }).catch((error) => {
        databasePromise = null
        throw error
      })
    }
    return databasePromise
  }

  async function removeExpired() {
    const db = await database()
    const transaction = db.transaction(['blobs', 'access'], 'readwrite')
    const completed = transactionComplete(transaction)
    const blobs = transaction.objectStore('blobs')
    const access = transaction.objectStore('access')
    const cutoff = Date.now() - MAX_ENTRY_AGE
    const cursorRequest = access.index('lastAccessed').openCursor(IDBKeyRange.upperBound(cutoff, true))

    try {
      await new Promise<void>((resolve, reject) => {
        cursorRequest.addEventListener('success', () => {
          const cursor = cursorRequest.result
          if (!cursor) {
            resolve()
            return
          }
          blobs.delete(cursor.primaryKey)
          cursor.delete()
          cursor.continue()
        })
        cursorRequest.addEventListener('error', () => reject(cursorRequest.error ?? new Error('Blob cleanup failed')), { once: true })
      })
    } catch (error) {
      await completed.catch(() => undefined)
      throw error
    }
    await completed
  }

  return {
    async get(key) {
      const db = await database()
      const transaction = db.transaction(['blobs', 'access'], 'readwrite')
      const completed = transactionComplete(transaction)
      let blob: Blob | undefined
      try {
        blob = await requestResult(transaction.objectStore('blobs').get(key)) as Blob | undefined
        if (blob !== undefined) {
          const access = transaction.objectStore('access')
          const previous = await requestResult(access.get(key)) as MediaAccess | undefined
          const now = Date.now()
          if (!previous || now - previous.lastAccessed > ACCESS_UPDATE_INTERVAL) {
            access.put({ lastAccessed: now } satisfies MediaAccess, key)
          }
        }
      } catch (error) {
        await completed.catch(() => undefined)
        throw error
      }
      await completed
      return blob
    },

    async put(key, blob) {
      const db = await database()
      const transaction = db.transaction(['blobs', 'access'], 'readwrite')
      const completed = transactionComplete(transaction)
      transaction.objectStore('blobs').put(blob, key)
      transaction.objectStore('access').put({ lastAccessed: Date.now() } satisfies MediaAccess, key)
      await completed

      const now = Date.now()
      if (now - lastCleanup >= CLEANUP_INTERVAL) {
        lastCleanup = now
        void removeExpired().catch((error) => console.error('[Telefast] Failed to clean blob cache', error))
      }
    },

    async clean() {
      const db = await database()
      const transaction = db.transaction(['blobs', 'access'], 'readwrite')
      const completed = transactionComplete(transaction)
      transaction.objectStore('blobs').clear()
      transaction.objectStore('access').clear()
      await completed
    },
  }
}
