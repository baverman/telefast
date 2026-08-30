import { useEffect } from 'preact/hooks'
import { ChatLayout } from '../components/chat-layout'
import { RequireAuth } from '../routing/require-auth'
import { setActiveChatPeerId } from '../telegram/active-chat'

export function ChatPage({ peerId }: { peerId: string }) {
  useEffect(() => {
    setActiveChatPeerId(peerId)
    return () => setActiveChatPeerId(null)
  }, [peerId])

  return (
    <RequireAuth>
      <ChatLayout selectedPeerId={peerId} />
    </RequireAuth>
  )
}
