import type { ComponentChildren } from 'preact'
import { useTelegram } from '../telegram/telegram-provider'
import { ConnectionScreen } from '../pages/login-page'
import { Redirect } from './redirect'

export function RequireAuth({ children }: { children: ComponentChildren }) {
  const { status } = useTelegram()
  if (status === 'unauthenticated') return <Redirect to="/login" />
  if (status === 'loading') return <ConnectionScreen />
  return <>{children}</>
}
