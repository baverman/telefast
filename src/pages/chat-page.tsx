import { useEffect } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import { ChatLayout } from '../components/chat-layout'
import { RequireAuth } from '../routing/require-auth'
import { setActiveChatPeerId } from '../telegram/active-chat'

export function ChatPage({ peerId }: { peerId: string }) {
  const location = useLocation()
  const threadId = Number.isSafeInteger(Number(location.query.thread)) ? Number(location.query.thread) : undefined
  useEffect(() => {
    setActiveChatPeerId(peerId)
    return () => setActiveChatPeerId(null)
  }, [peerId])

  return (
    <RequireAuth>
      <ChatLayout selectedPeerId={peerId} threadId={threadId} />
    </RequireAuth>
  )
}
