import { useEffect } from 'preact/hooks'
import type { Message } from '@mtcute/web'
import { useSendReaction } from '../telegram/queries'

const QUICK_REACTIONS = ['👍', '❤️', '😂', '🔥', '🎉', '😢']

export function ReactionBar({ message, peerId, threadId }: { message: Message; peerId: string; threadId?: number }) {
  const react = useSendReaction(peerId, threadId)
  const reactions = (message.reactions?.reactions ?? [])
    .filter((reaction) => typeof reaction.emoji === 'string')

  if (!reactions.length) return null

  return (
    <>
      {reactions.map((reaction) => {
        const emoji = reaction.emoji as string
        const active = reaction.order !== null
        return (
          <button
            key={emoji}
            type="button"
            class={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
              active
                ? 'border-sky-500 bg-sky-500/15 text-sky-300'
                : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
            }`}
            onClick={() => react.mutate({ messageId: message.id, emoji, remove: active })}
            title={active ? 'Remove reaction' : `React with ${emoji}`}
          >
            <span>{emoji}</span>
            <span class="tabular-nums">{reaction.count}</span>
          </button>
        )
      })}
    </>
  )
}

export function ReactionContextMenu({
  message,
  peerId,
  threadId,
  x,
  y,
  onClose,
}: {
  message: Message
  peerId: string
  threadId?: number
  x: number
  y: number
  onClose: () => void
}) {
  const react = useSendReaction(peerId, threadId)
  const reactions = message.reactions?.reactions ?? []
  const isActive = (emoji: string) => reactions.some((reaction) => reaction.emoji === emoji && reaction.order !== null)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <>
      <div
        class="fixed inset-0 z-40"
        onMouseDown={onClose}
        onContextMenu={(event) => {
          event.preventDefault()
          onClose()
        }}
      />
      <div
        class="fixed z-50 flex -translate-x-1/2 -translate-y-full gap-1 rounded-full border border-zinc-700 bg-zinc-900 px-1 py-1 shadow-2xl shadow-black/50"
        style={{ left: `${x}px`, top: `${y}px` }}
      >
        {QUICK_REACTIONS.map((emoji) => {
          const active = isActive(emoji)
          return (
            <button
              key={emoji}
              type="button"
              class={`grid size-7 place-items-center rounded-full text-base transition ${active ? 'bg-sky-500/25' : 'hover:bg-zinc-800'}`}
              title={active ? `Remove ${emoji}` : `React with ${emoji}`}
              onClick={() => {
                react.mutate({ messageId: message.id, emoji, remove: active })
                onClose()
              }}
            >
              {emoji}
            </button>
          )
        })}
      </div>
    </>
  )
}
