import { useTelegram, dialogId, type ChatState } from '../telegram/telegram-provider'
import { ChatSidebar } from './chat-sidebar'
import { Conversation, EmptyConversation } from './conversation'

const EMPTY_CHAT: ChatState = {
  messages: [],
  historyOffset: null,
  hasOlder: false,
  loading: false,
  loadingOlder: false,
}

export function ChatLayout({ selectedPeerId }: { selectedPeerId?: string }) {
  const { dialogs, chats, error, clearError } = useTelegram()
  const selected = selectedPeerId
    ? dialogs.find((dialog) => dialogId(dialog) === selectedPeerId)
    : undefined

  return (
    <main class="flex h-screen overflow-hidden bg-zinc-950 text-zinc-100">
      <ChatSidebar selectedPeerId={selected ? selectedPeerId : undefined} />
      {selected && selectedPeerId ? (
        <Conversation peerId={selectedPeerId} dialog={selected} chat={chats[selectedPeerId] ?? EMPTY_CHAT} />
      ) : (
        <EmptyConversation />
      )}
      {error && (
        <button
          class="fixed bottom-20 left-1/2 z-20 -translate-x-1/2 rounded-xl border border-red-900/60 bg-red-950 px-4 py-3 text-sm text-red-200 shadow-xl"
          onClick={clearError}
        >{error}</button>
      )}
    </main>
  )
}
