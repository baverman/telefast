import { useEffect, useState } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import type { Message } from '@mtcute/web'
import { useTelegram } from '../telegram/telegram-provider'
import { useDialog, type MessageReplyTarget } from '../telegram/queries'
import { setActiveChatPeerId } from '../telegram/active-chat'
import { canSendMessages } from '../telegram/model'
import { Avatar } from './media'
import { MessageList } from './message-list'
import { MessageComposer } from './message-composer'

export function Conversation({ peerId }: { peerId: string }) {
  const location = useLocation()
  const { client, markRead } = useTelegram()
  const selected = useDialog(peerId)
  const dialog = selected.data
  const [reply, setReply] = useState<MessageReplyTarget | null>(null)
  const [edit, setEdit] = useState<Message | null>(null)
  const threadId = Number.isSafeInteger(Number(location.query.thread)) ? Number(location.query.thread) : undefined
  const targetMessageId = Number.isSafeInteger(Number(location.query.message)) ? Number(location.query.message) : undefined
  const infoQuery = new URLSearchParams()
  if (threadId != null) infoQuery.set('thread', String(threadId))
  const infoHref = `/chat/${encodeURIComponent(peerId)}/info${infoQuery.size ? `?${infoQuery}` : ''}`

  useEffect(() => {
    setActiveChatPeerId(peerId)
    return () => setActiveChatPeerId(null)
  }, [peerId])

  useEffect(() => { setReply(null); setEdit(null) }, [peerId])

  useEffect(() => {
    if (!dialog?.unreadCount) return
    if (document.visibilityState !== 'visible' || !document.hasFocus()) return
    void markRead(peerId)
  }, [peerId, dialog?.unreadCount])

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
      </header>
      <MessageList
        peerId={peerId}
        dialog={dialog}
        threadId={threadId}
        targetMessageId={targetMessageId}
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
