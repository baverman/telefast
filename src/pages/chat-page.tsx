import { ChatLayout } from '../components/chat-layout'
import { RequireAuth } from '../routing/require-auth'

export function ChatPage({ peerId }: { peerId: string }) {
  return (
    <RequireAuth>
      <ChatLayout selectedPeerId={peerId} />
    </RequireAuth>
  )
}
