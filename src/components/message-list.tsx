import { useEffect, useRef } from 'preact/hooks'
import type { Dialog } from '@mtcute/web'
import { useTelegram, isGroupPeer } from '../telegram/telegram-provider'
import { useMessages, useSendText } from '../telegram/queries'
import { StickerView, timeLabel } from './media'
import { MessageContent } from './message-content'

export function MessageList({ peerId, dialog }: { peerId: string; dialog: Dialog }) {
  const { client } = useTelegram()
  const history = useMessages(peerId)
  const sendCommand = useSendText(peerId)
  const endRef = useRef<HTMLDivElement | null>(null)
  const shouldScrollBottom = useRef(true)

  useEffect(() => {
    if (shouldScrollBottom.current) endRef.current?.scrollIntoView({ block: 'end' })
    shouldScrollBottom.current = true
  }, [history.messages])

  return (
    <div class="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-8">
      <div class="mx-auto flex min-h-full max-w-3xl flex-col justify-end gap-2">
        {history.hasNextPage && (
          <button
            class="mx-auto mb-4 rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
            disabled={history.isFetchingNextPage}
            onClick={() => {
              shouldScrollBottom.current = false
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
            class={message.isService
              ? 'message-service'
              : message.media?.type === 'sticker'
                ? `sticker-message ${message.isOutgoing ? 'sticker-out' : 'sticker-in'}`
                : `message-bubble ${message.isOutgoing ? 'message-out' : 'message-in'}`
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
            <time class="mt-1 block text-right text-[10px] text-zinc-400/80">{timeLabel(message.date)}</time>
          </article>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  )
}
