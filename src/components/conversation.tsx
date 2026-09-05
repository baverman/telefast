import { useEffect, useState } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import type { Message } from '@mtcute/web'
import { useTelegram } from '../telegram/telegram-provider'
import { useCanPinMessages, useDialog, usePinnedMessages, type MessageReplyTarget } from '../telegram/queries'
import { canSendMessages } from '../telegram/model'
import { Avatar } from './media'
import { MessageList } from './message-list'
import { MessageComposer } from './message-composer'

function MessageSearchField({ peerId, initialQuery = '' }: { peerId: string; initialQuery?: string }) {
  const location = useLocation()
  const [query, setQuery] = useState(initialQuery)

  useEffect(() => setQuery(initialQuery), [peerId, initialQuery])

  return (
    <form
      class="ml-auto flex min-w-0 items-center self-center"
      role="search"
      onSubmit={(event) => {
        event.preventDefault()
        const value = query.trim()
        if (!value) return
        location.route(`/chat/${encodeURIComponent(peerId)}/search?q=${encodeURIComponent(value)}`)
      }}
    >
      <input
        type="search"
        value={query}
        onInput={(event) => setQuery(event.currentTarget.value)}
        placeholder="Search messages"
        aria-label="Search messages"
        class="header-search h-9 w-32 rounded-lg border px-3 text-sm leading-none text-zinc-100 outline-none sm:w-48 lg:w-64"
      />
    </form>
  )
}

export function Conversation({ peerId }: { peerId: string }) {
  const location = useLocation()
  const { client } = useTelegram()
  const selected = useDialog(peerId)
  const dialog = selected.data
  const [reply, setReply] = useState<MessageReplyTarget | null>(null)
  const [edit, setEdit] = useState<Message | null>(null)
  const threadId = Number.isSafeInteger(Number(location.query.thread)) ? Number(location.query.thread) : undefined
  const targetMessageId = Number.isSafeInteger(Number(location.query.message)) ? Number(location.query.message) : undefined
  const pinnedMessages = usePinnedMessages(peerId, threadId)
  const canPinMessages = useCanPinMessages(peerId)
  const infoQuery = new URLSearchParams()
  if (threadId != null) infoQuery.set('thread', String(threadId))
  const infoHref = `/chat/${encodeURIComponent(peerId)}/info${infoQuery.size ? `?${infoQuery}` : ''}`
  const pinnedQuery = new URLSearchParams()
  if (threadId != null) pinnedQuery.set('thread', String(threadId))
  const pinnedHref = `/chat/${encodeURIComponent(peerId)}/pinned${pinnedQuery.size ? `?${pinnedQuery}` : ''}`

  useEffect(() => { setReply(null); setEdit(null) }, [peerId])
  if (!dialog) return <EmptyConversation message={selected.isError ? 'Chat not found' : 'Loading chat…'} />
  return (
    <section class="flex min-w-0 flex-1 flex-col bg-chat">
      <header class="flex h-16 shrink-0 items-center gap-3 border-b border-zinc-800 bg-zinc-900/90 px-4 backdrop-blur">
        <a class="icon-button md:hidden" href="/chat" aria-label="Back to chats">←</a>
        <a
          href={infoHref}
          class="flex min-w-0 items-center gap-3 rounded-lg hover:text-sky-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
          aria-label={`Open information about ${dialog.peer.displayName}`}
        >
          <Avatar
            peer={dialog.peer}
            telegram={client}
            className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-sky-500 to-indigo-500 text-xs font-semibold"
          />
          <strong class="truncate text-sm font-medium">{dialog.peer.displayName}</strong>
        </a>
        <MessageSearchField peerId={peerId} />
        {pinnedMessages.total > 0 && (
          <a
            href={pinnedHref}
            class="icon-button grid-flow-col gap-1 px-2 text-xs"
            aria-label={`View ${pinnedMessages.total} pinned messages`}
            title="Pinned messages"
          >
            <span aria-hidden="true">📌</span>
            <span class="tabular-nums">{pinnedMessages.total}</span>
          </a>
        )}
      </header>
      <MessageList
        peerId={peerId}
        dialog={dialog}
        threadId={threadId}
        targetMessageId={targetMessageId}
        canPinMessages={canPinMessages.data === true}
        onReply={(target) => { setEdit(null); setReply(target) }}
        onEdit={(message) => { setReply(null); setEdit(message) }}
      />
      {canSendMessages(dialog.peer)
        ? (
          <MessageComposer
            peerId={peerId}
            threadId={threadId}
            reply={reply}
            edit={edit}
            onReplyChange={(target) => { setEdit(null); setReply(target) }}
            onEditChange={(message) => { setReply(null); setEdit(message) }}
          />
        )
        : (
          <div class="shrink-0 border-t border-zinc-800 bg-zinc-900 p-4 text-center text-sm text-zinc-500">
            You can't send messages here
          </div>
        )}
    </section>
  )
}

export function PinnedConversation({ peerId }: { peerId: string }) {
  const location = useLocation()
  const selected = useDialog(peerId)
  const dialog = selected.data
  const canPinMessages = useCanPinMessages(peerId)
  const threadId = Number.isSafeInteger(Number(location.query.thread)) ? Number(location.query.thread) : undefined
  const backQuery = new URLSearchParams()
  if (threadId != null) backQuery.set('thread', String(threadId))
  const backHref = `/chat/${encodeURIComponent(peerId)}${backQuery.size ? `?${backQuery}` : ''}`

  if (!dialog) return <EmptyConversation message={selected.isError ? 'Chat not found' : 'Loading chat…'} />

  return (
    <section class="flex min-w-0 flex-1 flex-col bg-chat">
      <header class="flex h-16 shrink-0 items-center gap-3 border-b border-zinc-800 bg-zinc-900/90 px-4 backdrop-blur">
        <a href={backHref} class="icon-button" aria-label="Back to chat">←</a>
        <strong class="text-sm font-medium">Pinned messages</strong>
        <MessageSearchField peerId={peerId} />
      </header>
      <MessageList
        peerId={peerId}
        dialog={dialog}
        threadId={threadId}
        pinned
        canPinMessages={canPinMessages.data === true}
        onReply={() => undefined}
        onEdit={() => undefined}
      />
    </section>
  )
}

export function SearchConversation({ peerId }: { peerId: string }) {
  const location = useLocation()
  const selected = useDialog(peerId)
  const dialog = selected.data
  const canPinMessages = useCanPinMessages(peerId)
  const query = typeof location.query.q === 'string' ? location.query.q.trim() : ''
  const backHref = `/chat/${encodeURIComponent(peerId)}`

  if (!dialog) return <EmptyConversation message={selected.isError ? 'Chat not found' : 'Loading chat…'} />

  return (
    <section class="flex min-w-0 flex-1 flex-col bg-chat">
      <header class="flex h-16 shrink-0 items-center gap-3 border-b border-zinc-800 bg-zinc-900/90 px-4 backdrop-blur">
        <a href={backHref} class="icon-button" aria-label="Back to chat">←</a>
        <strong class="text-sm font-medium">Search</strong>
        <MessageSearchField peerId={peerId} initialQuery={query} />
      </header>
      {query ? (
        <MessageList
          peerId={peerId}
          dialog={dialog}
          searchQuery={query}
          canPinMessages={canPinMessages.data === true}
          onReply={() => undefined}
          onEdit={() => undefined}
        />
      ) : (
        <div class="grid min-h-0 flex-1 place-items-center text-sm text-zinc-500">Enter a search query</div>
      )}
    </section>
  )
}

export function EmptyConversation({ message = 'Select a chat' }: { message?: string }) {
  return (
    <section class="hidden min-w-0 flex-1 flex-col bg-chat md:flex">
      <div class="m-auto text-center text-zinc-600">
        <div class="mx-auto mb-3 grid size-14 place-items-center rounded-2xl border border-zinc-800 text-xl">T</div>
        <p class="text-sm">{message}</p>
      </div>
    </section>
  )
}
