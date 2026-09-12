import type { Message } from '@mtcute/web'

export interface Chunk {
  start: number
  end: number
  messages: Message[]
  next: Link
  prev: Link
}

export type Link = Chunk | null

export interface Chain {
  head: Chunk
  tail: Chunk
}

export function chunkForMessage(message: Message): Chunk {
    return { messages: [message], start: message.id, end: message.id, prev: null, next: null }
}

export function getChainMessages(head: Chunk): Message[] {
    const messages: Message[] = []
    let chunk: Link = head
    while (chunk) {
        messages.push(...chunk.messages)
        chunk = chunk.next
    }
    return messages
}

export interface MessageStore {
  readonly chunks: Chunk[]
  subscribe(listener: () => void): () => void
  chunkById(id: number): Chunk | null
  update(chunk: Chunk): void
  remove(id: number): void
  chain(id?: number): Chain | null
}

function overlaps(a: Chunk, b: Chunk): boolean {
    return (a.start <= b.end) && (b.start <= a.end);
}

function link(a: Link, b: Link): void {
    if (a) a.next = b
    if (b) b.prev = a
}

class MessageStoreImpl implements MessageStore {
    readonly chunks: Chunk[] = []
    readonly listeners: Set<() => void> = new Set()

    private notify(): void {
        this.listeners.forEach((it) => {it()});
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {this.listeners.delete(listener)}
    }

    chunkById(id: number): Chunk | null {
        return this.chunks.find((it) => (id >= it.start) && (id <= it.end)) ?? null
    }

    update(chunk: Chunk): void {
        // TODO: optimization with single intersection of messages coming after existing messages
        if (!chunk.messages.length) {
            return;
        }
        chunk.messages.sort((a, b) => a.id - b.id);

        let insertAt = 0;
        const before: Chunk[] = []
        const after: Chunk[] = []
        const intersections: Chunk[] = []

        for(const [idx, it] of this.chunks.entries()) {
            if (chunk.start > it.end) {
                insertAt = idx + 1
            }
            if (overlaps(chunk, it)) {
                intersections.push(it)
            } else if (it.end + 1 == chunk.start) {
                before.push(it)
            } else if (it.start - 1 == chunk.end) {
                after.push(it)
            }
        }

        if (intersections.length) {
            const messages = []
            for(const it of intersections) {
                for(const m of it.messages) {
                    if (m.id < chunk.start || m.id > chunk.end) {
                       messages.push(m) 
                    }
                }
            }
            messages.push(...chunk.messages)
            messages.sort((a, b) => a.id - b.id);
            chunk.messages = messages
            const first = intersections[0]
            const last = intersections.at(-1)!
            if (chunk.start >= first.start) {
                chunk.start = first.start
                link(first.prev, chunk)
            }
            if (chunk.end <= last.end) {
                chunk.end = last.end
                link(chunk, last.next)
            }
        }

        if (before.length) {
            link(before.at(-1)!, chunk)
        }

        if (after.length) {
            link(chunk, after[0])
        }

        this.chunks.splice(insertAt, intersections.length, chunk);
        this.notify();
    }

    remove(id: number): void {
        // TODO: remove empty chunk
        const chunk = this.chunkById(id)
        if (chunk) {
            const idx = chunk.messages.findIndex((it) => it.id == id);
            if (idx >= 0) {
                chunk.messages.splice(idx, 1)
                if (!chunk.messages.length) {
                    link(chunk.prev, chunk.next)
                    if (chunk.prev) {
                        chunk.prev.end = chunk.end
                    } else if (chunk.next) {
                        chunk.next.start = chunk.start
                    }
                    const chunkIdx = this.chunks.indexOf(chunk)
                    if (chunkIdx >= 0) {
                        this.chunks.splice(chunkIdx, 1)
                    }
                }
                this.notify();
            }
        }
    }

    chain(id?: number): Chain | null {
        const chunk = id !== undefined
            ? this.chunkById(id)
            : this.chunks.at(-1) ?? null
        if (!chunk) return null

        let head = chunk
        while (head.prev) head = head.prev

        let tail = chunk
        while (tail.next) tail = tail.next

        return { head, tail }
    }
}

export function makeStore(): MessageStore {
    return new MessageStoreImpl()
}
