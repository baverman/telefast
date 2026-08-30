import type { Message } from '@mtcute/web'
import { useSendReaction } from '../telegram/queries'

const QUICK_REACTIONS = ['👍', '❤️', '😂', '🔥', '🎉', '😢']

export function ReactionBar({ message, peerId }: { message: Message; peerId: string }) {
  const react = useSendReaction(peerId)
  const reactions = message.reactions?.reactions ?? []
  const isActive = (emoji: string) => reactions.some((reaction) => reaction.emoji === emoji && reaction.order !== null)

  return (
    <div class={`mt-1.5 flex flex-wrap items-center gap-1 ${message.isOutgoing ? 'justify-end' : 'justify-start'}`}>
      {reactions
        .filter((reaction) => typeof reaction.emoji === 'string')
        .map((reaction) => {
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

      <div class="ml-1 flex gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
        {QUICK_REACTIONS.map((emoji) => {
          const active = isActive(emoji)
          return (
            <button
              key={emoji}
              type="button"
              class={`grid size-6 place-items-center rounded-full text-sm transition ${active ? 'bg-sky-500/25' : 'hover:bg-zinc-800'}`}
              title={active ? `Remove ${emoji}` : `React with ${emoji}`}
              onClick={() => react.mutate({ messageId: message.id, emoji, remove: active })}
            >
              {emoji}
            </button>
          )
        })}
      </div>
    </div>
  )
}
