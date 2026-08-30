import { useEffect } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import { ChatLayout } from '../components/chat-layout'
import { RequireAuth } from '../routing/require-auth'
import { useTelegram } from '../telegram/telegram-provider'

export function ChatPage({ peerId }: { peerId: string }) {
  const location = useLocation()
  const { status, chats, ensureDialog, loadChat, readChat } = useTelegram()

  useEffect(() => {
    if (status !== 'authenticated') return
    let active = true
    void ensureDialog(peerId).then((dialog) => {
      if (!active) return
      if (!dialog) {
        location.route('/', true)
        return
      }
      void loadChat(peerId)
    })
    return () => { active = false }
  }, [status, peerId])

  useEffect(() => {
    if (status === 'authenticated' && chats[peerId]?.messages.length) {
      void readChat(peerId)
    }
  }, [status, peerId, chats[peerId]?.messages.length])

  return (
    <RequireAuth>
      <ChatLayout selectedPeerId={peerId} />
    </RequireAuth>
  )
}
