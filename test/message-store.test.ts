import { describe, expect, it, vi } from 'vitest'
import type { Message } from '@mtcute/web'
import { getChainMessages, makeStore, type Chunk, type MessageStore } from '../src/telegram/message-store'

function message(id: number, text = String(id)) {
  return { id, text } as unknown as Message
}

function chunk(bounds: [number, number], ids: number[]): Chunk {
  return {
    start: bounds[0],
    end: bounds[1],
    messages: ids.map((id) => message(id)),
    prev: null,
    next: null,
  }
}

function expectChain(store: MessageStore, id: number | undefined, ids: number[]) {
  const chain = store.chain(id)
  if (!chain) {
    expect(ids).toEqual([])
    return
  }

  expect(getChainMessages(chain.head).map((entry) => entry.id)).toEqual(ids)
  expect(chain.head.prev).toBeNull()
  expect(chain.tail.next).toBeNull()
}

function expectStoreIds(store: MessageStore, ids: number[]) {
  expect(store.chunks.flatMap((item) => item.messages.map((entry) => entry.id))).toEqual(ids)
}

describe('MessageStore', () => {
  describe('update', () => {
    it('inserts ordered messages and notifies once', () => {
      const store = makeStore()
      const listener = vi.fn()
      store.subscribe(listener)

      store.update(chunk([10, 12], [12, 10, 11]))

      expectChain(store, 10, [10, 11, 12])
      expectChain(store, 12, [10, 11, 12])
      expect(store.chunkById(9)).toBeNull()
      expect(store.chunkById(13)).toBeNull()
      expect(listener).toHaveBeenCalledTimes(1)
      expectStoreIds(store, [10, 11, 12])
    })

    it('makes the newest range the default chain', () => {
      const store = makeStore()

      store.update(chunk([20, 29], [20, 29]))
      store.update(chunk([1, 9], [1, 9]))
      store.update(chunk([40, 49], [40, 49]))

      expectChain(store, 5, [1, 9])
      expectChain(store, 25, [20, 29])
      expectChain(store, 45, [40, 49])
      expectChain(store, undefined, [40, 49])
      expectStoreIds(store, [1, 9, 20, 29, 40, 49])
    })

    it('ignores a chunk with no messages', () => {
      const store = makeStore()
      const listener = vi.fn()
      store.subscribe(listener)

      store.update(chunk([1, 9], []))

      expectChain(store, undefined, [])
      expect(listener).not.toHaveBeenCalled()
      expectStoreIds(store, [])
    })

    it('leaves ranges with an unknown gap disconnected', () => {
      const store = makeStore()

      store.update(chunk([1, 8], [1, 3, 8]))
      store.update(chunk([10, 12], [10, 12]))

      expectChain(store, 5, [1, 3, 8])
      expectChain(store, 11, [10, 12])
      expectStoreIds(store, [1, 3, 8, 10, 12])
    })

    it('links ranges whose declared bounds are adjacent', () => {
      const store = makeStore()

      store.update(chunk([10, 19], [10, 12, 19]))
      store.update(chunk([1, 9], [1, 2, 3]))

      expectChain(store, 5, [1, 2, 3, 10, 12, 19])
      expectStoreIds(store, [1, 2, 3, 10, 12, 19])
    })

    it('links adjacent ranges regardless of insertion order', () => {
      const store = makeStore()

      store.update(chunk([1, 9], [1, 9]))
      store.update(chunk([10, 19], [10, 19]))

      expectChain(store, 15, [1, 9, 10, 19])
      expectStoreIds(store, [1, 9, 10, 19])
    })

    it('reconciles every range intersected by the supplied bounds', () => {
      const store = makeStore()

      store.update(chunk([1, 3], [1, 2, 3]))
      store.update(chunk([4, 6], [4, 5, 6]))
      const listener = vi.fn()
      store.subscribe(listener)

      store.update(chunk([2, 5], [2, 5]))

      const expected = [1, 2, 5, 6]
      expectChain(store, 1, expected)
      expectChain(store, 3, expected)
      expectChain(store, 4, expected)
      expectChain(store, 6, expected)
      expect(listener).toHaveBeenCalledTimes(1)
      expectStoreIds(store, expected)
    })

    it('uses the supplied range as the complete value inside its bounds', () => {
      const store = makeStore()
      store.update(chunk([1, 5], [1, 2, 3, 4, 5]))
      const replacement = message(2, 'replacement')

      store.update({
        start: 2,
        end: 4,
        messages: [replacement, message(4)],
        prev: null,
        next: null,
      })

      const expected = [1, 2, 4, 5]
      expectChain(store, 1, expected)
      expectChain(store, 3, expected)
      expectChain(store, 5, expected)
      expect(getChainMessages(store.chain(3)!.head).find((item) => item.id === 2)).toBe(replacement)
      expectStoreIds(store, expected)
    })

    it('preserves the outer edges when an intersecting range is replaced', () => {
      const store = makeStore()
      store.update(chunk([1, 9], [1, 9]))
      store.update(chunk([10, 19], [10, 19]))
      store.update(chunk([20, 29], [20, 29]))

      store.update(chunk([11, 18], [11, 18]))

      expectChain(store, 15, [1, 9, 10, 11, 18, 19, 20, 29])
      expectStoreIds(store, [1, 9, 10, 11, 18, 19, 20, 29])
    })
  })

  describe('lookup and chains', () => {
    it('finds a range by declared bounds when the exact message is absent', () => {
      const store = makeStore()
      store.update(chunk([1, 9], [1, 2, 3]))

      expectChain(store, 8, [1, 2, 3])
      expect(store.chunkById(0)).toBeNull()
      expect(store.chunkById(10)).toBeNull()
      expectStoreIds(store, [1, 2, 3])
    })

    it('returns the chain containing the requested id', () => {
      const store = makeStore()
      store.update(chunk([1, 9], [1, 9]))
      store.update(chunk([10, 19], [10, 19]))
      store.update(chunk([30, 39], [30, 39]))

      expectChain(store, 5, [1, 9, 10, 19])
      expectChain(store, 35, [30, 39])
      expectChain(store, 25, [])
      expectStoreIds(store, [1, 9, 10, 19, 30, 39])
      const chain = store.chain(5)!
      expect(chain.head.start).toBe(1)
      expect(chain.tail.end).toBe(19)
    })

    it('uses the newest range when chain is called without an id', () => {
      const store = makeStore()
      store.update(chunk([1, 9], [1, 9]))
      store.update(chunk([20, 29], [20, 29]))
      store.update(chunk([30, 39], [30, 39]))

      expectChain(store, undefined, [20, 29, 30, 39])
      expectStoreIds(store, [1, 9, 20, 29, 30, 39])
    })

    it('returns an empty chain for an empty store', () => {
      const store = makeStore()
      expectChain(store, undefined, [])
      expectStoreIds(store, [])
    })
  })

  describe('remove', () => {
    it('keeps declared bounds after removing messages at both ends', () => {
      const store = makeStore()
      store.update(chunk([1, 9], [1, 2, 3]))

      store.remove(1)
      store.remove(3)

      expectChain(store, 1, [2])
      expectChain(store, 9, [2])
      expectStoreIds(store, [2])
    })

    it('reconnects the chain when a middle range becomes empty', () => {
      const store = makeStore()
      store.update(chunk([1, 1], [1]))
      store.update(chunk([2, 2], [2]))
      store.update(chunk([3, 3], [3]))

      store.remove(2)

      expectChain(store, 1, [1, 3])
      expectChain(store, 2, [1, 3])
      expectChain(store, 3, [1, 3])
      expectChain(store, undefined, [1, 3])
      expectStoreIds(store, [1, 3])
    })


    it('preserves the chain when an update expands over a removed range', () => {
      const store = makeStore()
      store.update(chunk([1, 1], [1]))
      store.update(chunk([2, 9], [5]))
      store.update(chunk([10, 10], [10]))

      store.remove(5)

      expectChain(store, 1, [1, 10])
      expectChain(store, 5, [1, 10])
      expectChain(store, 10, [1, 10])

      store.update(chunk([5, 10], [5, 10]))

      expectChain(store, 1, [1, 5, 10])
      expectChain(store, 5, [1, 5, 10])
      expectChain(store, 10, [1, 5, 10])
      expectStoreIds(store, [1, 5, 10])
    })

    it('removes a range when its last message is removed', () => {
      const store = makeStore()
      store.update(chunk([1, 9], [5]))

      store.remove(5)

      expect(store.chunkById(1)).toBeNull()
      expect(store.chunkById(5)).toBeNull()
      expect(store.chunkById(9)).toBeNull()
      expectChain(store, undefined, [])
      expectStoreIds(store, [])
    })

    it('notifies once for a removal and does not notify for an unknown id', () => {
      const store = makeStore()
      store.update(chunk([1, 9], [1, 2]))
      const listener = vi.fn()
      store.subscribe(listener)

      store.remove(2)
      store.remove(99)

      expect(listener).toHaveBeenCalledTimes(1)
      expectStoreIds(store, [1])
    })
  })

  it('stops notifications after unsubscribe', () => {
    const store = makeStore()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    store.update(chunk([1, 1], [1]))
    unsubscribe()
    store.update(chunk([2, 2], [2]))

    expect(listener).toHaveBeenCalledTimes(1)
    expectStoreIds(store, [1, 2])
  })
})
