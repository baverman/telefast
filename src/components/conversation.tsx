import type { Dialog } from '@mtcute/web'
import { useTelegram } from '../telegram/telegram-provider'
import { canSendMessages } from '../telegram/model'
import { Avatar } from './media'
import { MessageList } from './message-list'
import { MessageComposer } from './message-composer'

export function Conversation({ peerId, dialog, threadId }: { peerId: string; dialog: Dialog; threadId?: number }) {
  const { client } = useTelegram()
  return (
    <section class="flex min-w-0 flex-1 flex-col bg-chat">
      <header class="flex h-16 shrink-0 items-center gap-3 border-b border-zinc-800 bg-zinc-900/90 px-4 backdrop-blur">
        <a class="icon-button md:hidden" href="/chat" aria-label="Back to chats">←</a>
        <Avatar
          peer={dialog.peer}
          telegram={client}
          className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-sky-500 to-indigo-500 text-xs font-semibold"
        />
        <strong class="truncate text-sm font-medium">{dialog.peer.displayName}</strong>
      </header>
      <MessageList peerId={peerId} dialog={dialog} threadId={threadId} />
      {canSendMessages(dialog.peer)
        ? <MessageComposer peerId={peerId} threadId={threadId} />
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
