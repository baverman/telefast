import type { ComponentChildren } from 'preact'
import { useTelegram } from '../telegram/telegram-provider'
import { ConnectionScreen } from '../pages/login-page'
import { Redirect } from './redirect'

export function RequireAuth({ children }: { children: ComponentChildren }) {
  const { status, error, reconnect } = useTelegram()
  if (status === 'unauthenticated') return <Redirect to="/login" />
  if (status === 'loading') return <ConnectionScreen />
  if (status === 'disconnected') return <ConnectionScreen error={error} onRetry={() => void reconnect()} />
  return <>{children}</>
}
