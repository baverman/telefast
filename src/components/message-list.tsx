import { useEffect, useRef, useState } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import type { Dialog, Message } from '@mtcute/web'
import { useTelegram, isGroupPeer } from '../telegram/telegram-provider'
import { useMessages, useSendText } from '../telegram/queries'
import { StickerView, timeLabel } from './media'
import { MessageContent } from './message-content'
import { ReactionBar, ReactionContextMenu } from './reaction-bar'

export function MessageList({ peerId, dialog, threadId }: { peerId: string; dialog: Dialog; threadId?: number }) {
  const { client } = useTelegram()
  const location = useLocation()
  const history = useMessages(peerId, threadId)
  const sendCommand = useSendText(peerId, threadId)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const previousCountRef = useRef(0)

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
  const [contextMenu, setContextMenu] = useState<{ message: Message; x: number; y: number } | null>(null)

  useEffect(() => {
    previousCountRef.current = 0
  }, [peerId, threadId])

  useEffect(() => {
    const container = containerRef.current
    const count = history.messages.length
    const previousCount = previousCountRef.current
    const isInitial = previousCount === 0 && count > 0
    const grew = count > previousCount
    const isNewOutgoing = grew && history.messages[count - 1]?.isOutgoing === true
    const nearBottom = container
      ? container.scrollHeight - container.scrollTop - container.clientHeight < 120
      : true
    previousCountRef.current = count

    if (isInitial || isNewOutgoing || nearBottom) {
      if (container) container.scrollTop = container.scrollHeight
    }
  }, [history.messages])

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
            onContextMenu={(event) => {
              if (window.getSelection()?.toString()) return
              event.preventDefault()
              setContextMenu({ message, x: event.clientX, y: event.clientY })
            }}
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
              <MessageContent message={message} telegram={client} onCommand={(command) => sendCommand.mutate(command)} />
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
        {contextMenu && (
          <ReactionContextMenu
            message={contextMenu.message}
            threadId={threadId}
            peerId={peerId}
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={() => setContextMenu(null)}
          />
        )}
      </div>
    </div>
  )
}
