import { useEffect, useRef } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import type { Dialog, Message } from '@mtcute/web'
import { useTelegram, isGroupPeer } from '../telegram/telegram-provider'
import { useMessages } from '../telegram/queries'
import { StickerView, timeLabel } from './media'
import { MessageContent } from './message-content'
import { ReactionBar } from './reaction-bar'

export function MessageList({ peerId, dialog, threadId }: { peerId: string; dialog: Dialog; threadId?: number }) {
  const { client } = useTelegram()
  const location = useLocation()
  const history = useMessages(peerId, threadId)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const previousCountRef = useRef(0)
  const initialScrollRef = useRef({
    key: '',
    lastReadIngoing: 0,
    hasUnread: false,
    done: false,
  })
  const chatKey = `${peerId}:${threadId ?? ''}`

  if (initialScrollRef.current.key !== chatKey) {
    initialScrollRef.current = {
      key: chatKey,
      lastReadIngoing: dialog.lastReadIngoing,
      hasUnread: threadId == null && dialog.unreadCount > 0,
      done: false,
    }
    previousCountRef.current = 0
  }

  async function openComments(post: Message) {
    if (!client) return
    try {
      const discussion = await client.getDiscussionMessage({ message: post })
      if (!discussion) return
      location.route(`/chat/${String(discussion.chat.id)}?thread=${discussion.id}`)
    } catch (error) {
      console.error('[Telefast] Failed to open comments', error)
    }
  }

  useEffect(() => {
    const container = containerRef.current
    const count = history.messages.length
    const previousCount = previousCountRef.current
    const grew = count > previousCount
    const isNewOutgoing = grew && history.messages[count - 1]?.isOutgoing === true
    const nearBottom = container
      ? container.scrollHeight - container.scrollTop - container.clientHeight < 120
      : true
    previousCountRef.current = count

    if (!container || count === 0) return

    const initialScroll = initialScrollRef.current
    if (!initialScroll.done) {
      if (initialScroll.hasUnread) {
        const oldestMessage = history.messages[0]
        if (oldestMessage.id > initialScroll.lastReadIngoing && history.hasNextPage) {
          if (!history.isFetchingNextPage) void history.fetchNextPage()
          return
        }

        const firstUnread = history.messages.find((message) => (
          !message.isOutgoing && message.id > initialScroll.lastReadIngoing
        ))
        const target = firstUnread
          ? container.querySelector<HTMLElement>(`[data-message-id="${firstUnread.id}"]`)
          : null
        if (target) target.scrollIntoView({ block: 'start' })
        else container.scrollTop = container.scrollHeight
      } else {
        container.scrollTop = container.scrollHeight
      }
      initialScroll.done = true
      return
    }

    if (isNewOutgoing || nearBottom) container.scrollTop = container.scrollHeight
  }, [history.messages, history.hasNextPage, history.isFetchingNextPage])

  return (
    <div ref={containerRef} class="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-8">
      <div class="mx-auto flex min-h-full max-w-3xl flex-col justify-end gap-2">
        {history.hasNextPage && (
          <button
            class="mx-auto mb-4 rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
            disabled={history.isFetchingNextPage}
            onClick={() => {
              void history.fetchNextPage()
            }}
          >
            {history.isFetchingNextPage ? 'Loading…' : 'Load older messages'}
          </button>
        )}
        {history.isPending && <p class="my-auto text-center text-sm text-zinc-500">Loading messages…</p>}
        {history.isError && <p class="my-auto text-center text-sm text-red-300">Failed to load messages.</p>}
        {history.messages.map((message) => (
          <article
            key={message.id}
            data-message-id={message.id}
            class={message.isService
              ? 'message-service'
              : `group ${message.media?.type === 'sticker'
                  ? `sticker-message ${message.isOutgoing ? 'sticker-out' : 'sticker-in'}`
                  : `message-bubble ${message.isOutgoing ? 'message-out' : 'message-in'}`}`
            }
          >
            {isGroupPeer(dialog.peer) && !message.isOutgoing && (
              <p class="mb-1 text-xs font-medium text-sky-300">{message.sender.displayName}</p>
            )}
            {message.media?.type === 'sticker' ? (
              <StickerView sticker={message.media} telegram={client} />
            ) : (
              <MessageContent message={message} telegram={client} />
            )}
            <div class="mt-1 flex flex-wrap items-center gap-1">
              {message.replies?.hasComments && message.replies.discussion != null && (
                <button
                  type="button"
                  class="inline-flex items-center gap-1 rounded-full bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-400 hover:text-sky-300"
                  onClick={() => void openComments(message)}
                >
                  💬 {message.replies.count > 0 ? message.replies.count : 'Comments'}
                </button>
              )}
              {!message.isService && <ReactionBar message={message} peerId={peerId} threadId={threadId} />}
              <time class="ml-auto text-[10px] text-zinc-400/80">{timeLabel(message.date)}</time>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
