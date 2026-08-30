import { useTelegram } from '../telegram/telegram-provider'
import { useDialog } from '../telegram/queries'
import { ChatSidebar } from './chat-sidebar'
import { Conversation, EmptyConversation } from './conversation'

export function ChatLayout({ selectedPeerId, threadId }: { selectedPeerId?: string; threadId?: number }) {
  const { error, clearError } = useTelegram()
  const selected = useDialog(selectedPeerId)

  return (
    <main class="flex h-screen overflow-hidden bg-zinc-950 text-zinc-100">
      <ChatSidebar selectedPeerId={selected.data ? selectedPeerId : undefined} />
      {selected.data && selectedPeerId ? (
        <Conversation peerId={selectedPeerId} dialog={selected.data} threadId={threadId} />
      ) : (
        <EmptyConversation message={selected.isError ? 'Chat not found' : undefined} />
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
