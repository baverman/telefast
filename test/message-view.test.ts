import { describe, expect, it, vi } from 'vitest'
import type { Message } from '@mtcute/web'
import type { TelefastClient } from '../src/telegram'
import { MessageViewImpl } from '../src/telegram/message-view'
import { makeStore } from '../src/telegram/message-store'

function message(id: number) {
  return { id } as unknown as Message
}

function ids(view: { chain(): Message[] }) {
  return view.chain().map((entry) => entry.id)
}

/** Builds a client whose searchMessages reads from a page map. */
function client(
  latest: number[],
  byOffset: Record<number, number[]> = {},
  around: number[] = [],
) {
  const searchMessages = vi.fn(async (params: { offset?: number; addOffset?: number }) => {
    if (params.offset == null) return latest.map(message)
    if (params.addOffset != null) {
      const explicit = (params as { addOffset: number; offset: number }).offset
      return (around.length && explicit != null ? around : byOffset[explicit] ?? []).map(message)
    }
    return (byOffset[params.offset] ?? []).map(message)
  })
  return { searchMessages, client: { searchMessages } as unknown as TelefastClient }
}

describe('MessageView', () => {
  it('loads the latest page into an ascending chain', async () => {
    const { client: telegram, searchMessages } = client([3, 2, 1])
    const view = new MessageViewImpl(makeStore(), telegram, '5', {}, () => {})

    await view.start()

    expect(searchMessages).toHaveBeenCalledWith(expect.objectContaining({ chatId: 5, limit: 100 }))
    expect(ids(view)).toEqual([1, 2, 3])
    expect(view.isLoading).toBe(false)
    expect(view.isError).toBe(false)
    expect(view.canLoadPrev).toBe(true)
  })

  it('reuses the selected chain on the second mount', async () => {
    const { client: telegram, searchMessages } = client([3, 2, 1])
    const store = makeStore()
    const first = new MessageViewImpl(store, telegram, '5', {}, () => {})
    await first.start()

    const second = new MessageViewImpl(store, telegram, '5', {}, () => {})
    await second.start()

    expect(searchMessages).toHaveBeenCalledTimes(1)
    expect(ids(second)).toEqual([1, 2, 3])
  })

  it('uses the head start as offset and declares the covered older range', async () => {
    const { client: telegram } = client([50, 49, 48], { 48: [47, 46] })
    const view = new MessageViewImpl(makeStore(), telegram, '5', {}, () => {})
    await view.start()

    await view.loadPrev()

    expect(ids(view)).toEqual([46, 47, 48, 49, 50])
    expect(view.canLoadPrev).toBe(true)
  })

  it('uses the tail end as offset and declares the covered newer range', async () => {
    const { client: telegram } = client([], {}, [31, 30, 29])
    const view = new MessageViewImpl(makeStore(), telegram, '5', { anchorId: 30 }, () => {})
    await view.start()
    expect(ids(view)).toEqual([29, 30, 31])

    const searchMessages = telegram.searchMessages as unknown as ReturnType<typeof vi.fn>
    searchMessages.mockImplementationOnce(async () => [60, 59, 58].map(message))
    await view.loadNext()

    expect(ids(view)).toEqual([29, 30, 31, 58, 59, 60])
  })

  it('discards messages on the wrong side of the offset', async () => {
    const { client: telegram } = client([3, 2, 1], { 1: [1, 0] })
    const view = new MessageViewImpl(makeStore(), telegram, '5', {}, () => {})
    await view.start()

    await view.loadPrev()

    expect(ids(view)).toEqual([0, 1, 2, 3])
  })

  it('marks an empty directional page as exhausted', async () => {
    const { client: telegram } = client([3, 2, 1], { 1: [] })
    const view = new MessageViewImpl(makeStore(), telegram, '5', {}, () => {})
    await view.start()

    await view.loadPrev()

    expect(view.canLoadPrev).toBe(false)
    expect(ids(view)).toEqual([1, 2, 3])
  })

  it('reports an initial-load failure and no directional failure', async () => {
    const searchMessages = vi.fn(async () => { throw new Error('offline') })
    const store = makeStore()
    const failing = new MessageViewImpl(store, { searchMessages } as unknown as TelefastClient, '5', {}, () => {})
    await failing.start()
    expect(failing.isError).toBe(true)
    expect(ids(failing)).toEqual([])

    const { client: telegram } = client([3, 2, 1], { 1: [] })
    const failingDirection = new MessageViewImpl(store, telegram, '5', {}, () => {})
    await failingDirection.start()
    const original = telegram.searchMessages as unknown as ReturnType<typeof vi.fn>
    original.mockRejectedValueOnce(new Error('offline'))
    await failingDirection.loadPrev()
    expect(failingDirection.isError).toBe(false)
    expect(failingDirection.canLoadPrev).toBe(true)
  })

  it('loads a page around the anchor when the store has no chain', async () => {
    const { client: telegram, searchMessages } = client([], {}, [31, 30, 29])
    const view = new MessageViewImpl(makeStore(), telegram, '5', { anchorId: 30 }, () => {})

    await view.start()

    expect(searchMessages).toHaveBeenCalledWith(expect.objectContaining({ offset: 30, addOffset: -25, limit: 50 }))
    expect(ids(view)).toEqual([29, 30, 31])
  })

  it('selects the around window by range even when the anchor message is absent', async () => {
    const { client: telegram } = client([], {}, [103, 102, 101, 99, 98])
    const store = makeStore()
    store.update({ messages: [message(200), message(210)], start: 200, end: 210, prev: null, next: null })
    const view = new MessageViewImpl(store, telegram, '5', { anchorId: 100 }, () => {})

    await view.start()

    expect(ids(view)).toEqual([98, 99, 101, 102, 103])
  })
})
