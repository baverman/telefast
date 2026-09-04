import { Route, Router, useLocation } from 'preact-iso'
import { useTelegram } from '../telegram/telegram-provider'
import { RequireAuth } from '../routing/require-auth'
import { ChatSidebar } from './chat-sidebar'
import { Conversation, EmptyConversation } from './conversation'
import { PeerInfo } from './peer-info'

export function ChatLayout() {
  const location = useLocation()
  const { error, clearError } = useTelegram()
  const selectedPeerId = location.path.match(/^\/chat\/([^/]+)/)?.[1]

  return (
    <RequireAuth>
      <main class="flex h-screen overflow-hidden bg-zinc-950 text-zinc-100">
        <ChatSidebar selectedPeerId={selectedPeerId ? decodeURIComponent(selectedPeerId) : undefined} />
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
