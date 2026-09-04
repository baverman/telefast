import { useEffect } from 'preact/hooks'
import { Route, Router, useLocation } from 'preact-iso'
import { dialogId, useTelegram } from '../telegram/telegram-provider'
import { useDialogs } from '../telegram/queries'
import { setActiveChatPeerId } from '../telegram/active-chat'
import { RequireAuth } from '../routing/require-auth'
import { ChatSidebar } from './chat-sidebar'
import { Conversation, EmptyConversation } from './conversation'
import { PeerInfo } from './peer-info'

export function ChatLayout() {
  const location = useLocation()
  const { error, clearError, markRead } = useTelegram()
  const dialogs = useDialogs()
  const encodedPeerId = location.path.match(/^\/chat\/([^/]+)/)?.[1]
  const selectedPeerId = encodedPeerId ? decodeURIComponent(encodedPeerId) : undefined
  const hasUnread = (dialogs.data?.find((dialog) => dialogId(dialog) === selectedPeerId)?.unreadCount ?? 0) > 0

  useEffect(() => {
    setActiveChatPeerId(selectedPeerId ?? null)
    return () => setActiveChatPeerId(null)
  }, [selectedPeerId])

  useEffect(() => {
    if (!selectedPeerId || !hasUnread) return
    if (document.visibilityState !== 'visible' || !document.hasFocus()) return
    void markRead(selectedPeerId)
  }, [selectedPeerId, hasUnread])

  return (
    <RequireAuth>
      <main class="flex h-screen overflow-hidden bg-zinc-950 text-zinc-100">
        <ChatSidebar selectedPeerId={selectedPeerId} />
        <div class="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <Router>
            <Route path="/" component={EmptyConversation} />
            <Route path="/:peerId" component={Conversation} />
            <Route path="/:peerId/info" component={PeerInfo} />
            <Route default component={EmptyConversation} message="Page not found" />
          </Router>
        </div>
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
