import { ChatLayout } from '../components/chat-layout'
import { RequireAuth } from '../routing/require-auth'

export function ChatListPage() {
  return (
    <RequireAuth>
      <ChatLayout />
    </RequireAuth>
  )
}
