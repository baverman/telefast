import { useEffect, useRef } from 'preact/hooks'
import type { Dialog } from '@mtcute/web'
import { useTelegram, isGroupPeer, type ChatState } from '../telegram/telegram-provider'
import { MessageText, StickerView, timeLabel } from './media'

export function MessageList({ peerId, dialog, chat }: { peerId: string; dialog: Dialog; chat: ChatState }) {
  const { client, loadOlder } = useTelegram()
  const endRef = useRef<HTMLDivElement | null>(null)
  const shouldScrollBottom = useRef(true)

  useEffect(() => {
    if (shouldScrollBottom.current) endRef.current?.scrollIntoView({ block: 'end' })
    shouldScrollBottom.current = true
  }, [chat.messages])

  return (
    <div class="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-8">
      <div class="mx-auto flex min-h-full max-w-3xl flex-col justify-end gap-2">
        {chat.hasOlder && (
          <button
            class="mx-auto mb-4 rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
            disabled={chat.loadingOlder}
            onClick={() => {
              shouldScrollBottom.current = false
              void loadOlder(peerId)
            }}
          >
            {chat.loadingOlder ? 'Loading…' : 'Load older messages'}
          </button>
        )}
        {chat.loading && !chat.messages.length && <p class="my-auto text-center text-sm text-zinc-500">Loading messages…</p>}
        {chat.messages.map((message) => (
          <article
            key={message.id}
            class={message.media?.type === 'sticker'
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
              <p class="whitespace-pre-wrap break-words text-[15px] leading-5">
                {message.text ? <MessageText message={message} /> : 'Unsupported message'}
              </p>
            )}
            <time class="mt-1 block text-right text-[10px] text-zinc-400/80">{timeLabel(message.date)}</time>
          </article>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  )
}
