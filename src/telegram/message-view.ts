import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import { SearchFilters, type Message } from '@mtcute/web'
import type { TelefastClient } from '../telegram'
import { useTelegram } from './telegram-provider'
import { getChainMessages, makeStore, type Chain, type Chunk, type MessageStore } from './message-store'

export const DEFAULT_PAGE_LIMIT = 100
export const AROUND_PAGE_LIMIT = 50
const AROUND_OFFSET = 25

export interface MessageViewOptions {
  threadId?: number
  anchorId?: number
  search?: string
  isPinned?: boolean
  cacheKey?: string
}

export interface MessageView {
  chain(): Message[]
  loadPrev(): Promise<void>
  loadNext(): Promise<void>
  readonly canLoadPrev: boolean
  readonly canLoadNext: boolean
  readonly isLoading: boolean
  readonly isError: boolean
  readonly isPrevLoading: boolean
  readonly isNextLoading: boolean
}

interface PageRequest {
  offset?: number
  addOffset?: number
  around?: boolean
}

interface ChunkBounds {
  start?: number
  end?: number
}

export class MessageViewImpl implements MessageView {
  private readonly store: MessageStore
  private readonly client: TelefastClient | null
  private readonly peerId: string
  private readonly threadId?: number
  private readonly anchorId?: number
  private readonly search?: string
  private readonly isPinned: boolean
  private readonly onChange: () => void

  private cached: Message[] | null = null
  private prevExhausted = false
  private nextExhausted = false
  private loading = true
  private error = false
  private prevLoading = false
  private nextLoading = false
  private disposed = false
  private unsubscribe: (() => void) | null = null

  constructor(
    store: MessageStore,
    client: TelefastClient | null,
    peerId: string,
    options: MessageViewOptions,
    onChange: () => void,
  ) {
    this.store = store
    this.client = client
    this.peerId = peerId
    this.threadId = options.threadId
    this.anchorId = options.anchorId
    this.search = options.search
    this.isPinned = options.isPinned === true
    this.onChange = onChange
    this.loading = !this.hasInitialChain()
  }

  private selectedChain(): Chain | null {
    if (this.anchorId != null) return this.store.chain(this.anchorId)
    return this.store.chain()
  }

  private hasInitialChain(): boolean {
    if (this.anchorId != null) return this.store.chain(this.anchorId) != null
    return this.store.chain() != null
  }

  private notify(): void {
    if (!this.disposed) this.onChange()
  }

  private toChunk(messages: Message[], bounds: ChunkBounds): Chunk {
    const ordered = [...messages].sort((a, b) => a.id - b.id)
    return {
      messages: ordered,
      start: bounds.start ?? ordered[0].id,
      end: bounds.end ?? ordered[ordered.length - 1].id,
      prev: null,
      next: null,
    }
  }

  private async fetchPage(params: PageRequest): Promise<Message[]> {
    const client = this.client
    if (!client) throw new Error('Telegram connection is not ready')
    const options = {
      chatId: Number(this.peerId),
      threadId: this.threadId,
      limit: params.around ? AROUND_PAGE_LIMIT : DEFAULT_PAGE_LIMIT,
      ...(this.search != null ? { query: this.search } : {}),
      ...(this.isPinned ? { filter: SearchFilters.Pinned } : {}),
      ...(params.offset != null ? { offset: params.offset } : {}),
      ...(params.addOffset != null ? { addOffset: params.addOffset } : {}),
    }
    console.log('Message view searchMessages', options)
    const result = await client.searchMessages(options)
    return [...result]
  }

  start(): Promise<void> {
    this.unsubscribe = this.store.subscribe(() => {
      this.cached = null
      this.notify()
    })
    return this.loadInitial()
  }

  dispose(): void {
    this.disposed = true
    this.unsubscribe?.()
    this.unsubscribe = null
  }

  private async loadInitial(): Promise<void> {
    if (this.hasInitialChain()) {
      this.loading = false
      this.notify()
      return
    }
    this.loading = true
    this.error = false
    try {
      const page = this.anchorId != null
        ? await this.fetchPage({ offset: this.anchorId, addOffset: -AROUND_OFFSET, around: true })
        : await this.fetchPage({})
      if (this.disposed) return
      const chunk = page.length ? this.toChunk(page, {}) : null
      if (chunk) this.store.update(chunk)
    } catch {
      if (this.disposed) return
      this.error = true
    } finally {
      if (!this.disposed) {
        this.loading = false
        this.notify()
      }
    }
  }

  loadPrev = async (): Promise<void> => {
    if (this.prevLoading || this.prevExhausted) return
    const selected = this.selectedChain()
    if (!selected || selected.head.prev !== null) return

    this.prevLoading = true
    this.notify()
    const offset = selected.head.start
    try {
      const page = await this.fetchPage({ offset })
      if (this.disposed) return
      const older = page.filter((message) => message.id < offset)
      if (!older.length) this.prevExhausted = true
      else this.store.update(this.toChunk(older, { end: offset - 1 }))
    } catch {
      // Keep the edge open for a retry.
    } finally {
      if (!this.disposed) {
        this.prevLoading = false
        this.notify()
      }
    }
  }

  loadNext = async (): Promise<void> => {
    if (this.nextLoading || this.nextExhausted) return
    const selected = this.selectedChain()
    if (!selected || selected.tail.next !== null) return

    this.nextLoading = true
    this.notify()
    const offset = selected.tail.end
    try {
      const page = await this.fetchPage({ offset, addOffset: -DEFAULT_PAGE_LIMIT })
      if (this.disposed) return
      const newer = page.filter((message) => message.id > offset)
      if (!newer.length) this.nextExhausted = true
      else this.store.update(this.toChunk(newer, { start: offset + 1 }))
    } catch {
      // Keep the edge open for a retry.
    } finally {
      if (!this.disposed) {
        this.nextLoading = false
        this.notify()
      }
    }
  }

  chain(): Message[] {
    if (!this.cached) {
      const selected = this.selectedChain()
      this.cached = selected ? getChainMessages(selected.head) : []
    }
    return this.cached
  }

  get canLoadPrev(): boolean {
    if (this.prevExhausted) return false
    const selected = this.selectedChain()
    return selected != null && selected.head.prev === null
  }

  get canLoadNext(): boolean {
    if (this.nextExhausted) return false
    const selected = this.selectedChain()
    return selected != null && selected.tail.next === null
  }

  get isLoading(): boolean {
    return this.loading
  }

  get isError(): boolean {
    return this.error
  }

  get isPrevLoading(): boolean {
    return this.prevLoading
  }

  get isNextLoading(): boolean {
    return this.nextLoading
  }
}

export function useMessageView(peerId: string, options: MessageViewOptions = {}): MessageView {
  const { client, messageStores } = useTelegram()
  const { threadId, anchorId, search, isPinned, cacheKey } = options

  const store = useMemo(() => {
    if (cacheKey != null) {
      const existing = messageStores.get(cacheKey)
      if (existing) return existing
      const created = makeStore()
      messageStores.set(cacheKey, created)
      return created
    }
    return makeStore()
  }, [cacheKey, messageStores])

  const [, setRevision] = useState(0)
  const notify = useCallback(() => setRevision((revision) => revision + 1), [])

  const view = useMemo(
    () => new MessageViewImpl(store, client, peerId, { threadId, anchorId, search, isPinned }, notify),
    [store, client, peerId, threadId, anchorId, search, isPinned, notify],
  )

  useEffect(() => {
    void view.start()
    return () => view.dispose()
  }, [view])

  return view
}
