import { useEffect } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import { dialogId, useTelegram } from '../telegram/telegram-provider'
import { useDialogs, useDialog } from '../telegram/queries'
import { setActiveChatPeerId } from '../telegram/active-chat'
import { RequireAuth } from '../routing/require-auth'
import { ChatSidebar } from './chat-sidebar'
import { Conversation, EmptyConversation } from './conversation'

export function ChatLayout({ peerId }: { peerId?: string }) {
  const location = useLocation()
  const { error, clearError, markRead } = useTelegram()
  const dialogs = useDialogs()
  const selected = useDialog(peerId)
  const threadId = Number.isSafeInteger(Number(location.query.thread)) ? Number(location.query.thread) : undefined
  const hasUnread = (dialogs.data?.find((item) => dialogId(item) === peerId)?.unreadCount ?? 0) > 0

  useEffect(() => {
    setActiveChatPeerId(peerId ?? null)
    return () => setActiveChatPeerId(null)
  }, [peerId])

  useEffect(() => {
    if (!peerId || !hasUnread) return
    if (document.visibilityState !== 'visible' || !document.hasFocus()) return
    void markRead(peerId)
  }, [peerId, hasUnread])

  return (
    <RequireAuth>
      <main class="flex h-screen overflow-hidden bg-zinc-950 text-zinc-100">
        <ChatSidebar selectedPeerId={selected.data ? peerId : undefined} />
        {selected.data && peerId ? (
          <Conversation peerId={peerId} dialog={selected.data} threadId={threadId} />
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
    </RequireAuth>
  )
}
