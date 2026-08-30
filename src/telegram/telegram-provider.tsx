import { createContext, type ComponentChildren } from 'preact'
import { useContext, useEffect, useRef, useState } from 'preact/hooks'
import type { SentCode } from '@mtcute/web'
import { useQueryClient } from '@tanstack/preact-query'
import { useLocation } from 'preact-iso'
import { createTelegramConnection, type TelefastClient } from '../telegram'
import { appendMessage, cachedDialog, telegramKeys } from './query-data'
import { isGroupPeer, isSupportedPeer, messageText } from './model'

export { dialogId, isGroupPeer } from './model'

const STORAGE = {
  apiId: 'telefast.apiId',
  apiHash: 'telefast.apiHash',
}

export type AuthStep = 'credentials' | 'code' | 'password'
export type SessionStatus = 'loading' | 'unauthenticated' | 'authenticated'
type Resolver = (value: string) => void
type Connection = ReturnType<typeof createTelegramConnection>

interface BeginLoginInput {
  apiId: number
  apiHash: string
  phone: string
}

interface TelegramContextValue {
  status: SessionStatus
  authStep: AuthStep
  passwordHint: string
  deliveryLabel: string
  busy: boolean
  error: string
  client: TelefastClient | null
  notificationPermission: NotificationPermission | 'unsupported'
  beginLogin(input: BeginLoginInput): Promise<void>
  submitCode(code: string): void
  submitPassword(password: string): void
  logout(): Promise<void>
  clearError(): void
  enableNotifications(): Promise<void>
}

const TelegramContext = createContext<TelegramContextValue | null>(null)

function errorText(error: unknown) {
  if (error instanceof Error) {
    const message = error.message.replaceAll('_', ' ')
    return error.name && error.name !== 'Error' ? `${error.name}: ${message}` : message
  }
  return String(error)
}

function reportError(context: string, error: unknown) {
  console.error(`[Telefast] ${context}`, error)
  return errorText(error)
}

function codeDeliveryLabel(sentCode: SentCode) {
  switch (sentCode.type) {
    case 'app': return 'to your Telegram app'
    case 'sms':
    case 'sms_phrase':
    case 'sms_word': return 'by SMS'
    case 'email': return 'by email'
    case 'call':
    case 'flash_call':
    case 'missed_call': return 'by phone call'
    default: return `through ${sentCode.type.replaceAll('_', ' ')}`
  }
}

export function TelegramProvider({ children }: { children: ComponentChildren }) {
  const location = useLocation()
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<SessionStatus>('loading')
  const [authStep, setAuthStep] = useState<AuthStep>('credentials')
  const [passwordHint, setPasswordHint] = useState('')
  const [deliveryLabel, setDeliveryLabel] = useState('to your Telegram app')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  )
  const connectionRef = useRef<Connection | null>(null)
  const codeResolver = useRef<Resolver | null>(null)
  const passwordResolver = useRef<Resolver | null>(null)
  const client = connectionRef.current?.client ?? null

  function attachUpdates(telegram: TelefastClient) {
    telegram.onNewMessage.add((message) => {
      if (!isSupportedPeer(message.chat)) return
      const peerId = String(message.chat.id)
      const queryKey = telegramKeys.messages(peerId)
      appendMessage(queryClient, peerId, message)
      const active = (queryClient.getQueryCache().find({ queryKey, exact: true })?.getObserversCount() ?? 0) > 0
      const target = cachedDialog(queryClient, peerId)

      if (!message.isOutgoing && active && document.hasFocus()) {
        void telegram.readHistory(message.chat).then(() => (
          queryClient.invalidateQueries({ queryKey: telegramKeys.dialogs() })
        ))
      } else if (
        !message.isOutgoing && target && target.isMuted !== true &&
        typeof Notification !== 'undefined' && Notification.permission === 'granted' &&
        !document.hasFocus()
      ) {
        const body = isGroupPeer(target.peer)
          ? `${message.sender.displayName}: ${messageText(message)}`
          : messageText(message)
        const notification = new Notification(target.peer.displayName, {
          body: body || 'New message',
          tag: `telefast-${peerId}`,
        })
        notification.onclick = () => {
          window.focus()
          location.route(`/chat/${encodeURIComponent(peerId)}`)
          notification.close()
        }
      }
      void queryClient.invalidateQueries({ queryKey: telegramKeys.dialogs() })
    })
  }

  function enterChats(connection: Connection) {
    connectionRef.current = connection
    attachUpdates(connection.client)
    setStatus('authenticated')
    setBusy(false)
  }

  useEffect(() => {
    let cancelled = false
    localStorage.removeItem('telefast.session')
    void (async () => {
      const storedApiId = localStorage.getItem(STORAGE.apiId)
      const storedApiHash = localStorage.getItem(STORAGE.apiHash)
      if (!storedApiId || !storedApiHash) {
        setStatus('unauthenticated')
        return
      }
      const connection = createTelegramConnection(Number(storedApiId), storedApiHash)
      connectionRef.current = connection
      try {
        await connection.client.start({})
        if (cancelled) {
          await connection.destroy()
          return
        }
        enterChats(connection)
      } catch {
        await connection.destroy()
        connectionRef.current = null
        if (!cancelled) setStatus('unauthenticated')
      }
    })()
    return () => { cancelled = true }
  }, [])

  async function beginLogin(input: BeginLoginInput) {
    setError('')
    localStorage.setItem(STORAGE.apiId, String(input.apiId))
    localStorage.setItem(STORAGE.apiHash, input.apiHash)
    setBusy(true)
    if (connectionRef.current) await connectionRef.current.destroy()
    const connection = createTelegramConnection(input.apiId, input.apiHash)
    connectionRef.current = connection
    try {
      await connection.client.start({
        phone: input.phone,
        codeSentCallback: (sentCode) => setDeliveryLabel(codeDeliveryLabel(sentCode)),
        code: async () => {
          setAuthStep('code')
          setBusy(false)
          return new Promise<string>((resolve) => { codeResolver.current = resolve })
        },
        password: async () => {
          setPasswordHint((await connection.client.getPasswordHint()) ?? '')
          setAuthStep('password')
          setBusy(false)
          return new Promise<string>((resolve) => { passwordResolver.current = resolve })
        },
        invalidCodeCallback: (type) => {
          setError(type === 'code' ? 'The login code is invalid.' : 'The password is invalid.')
          setBusy(false)
        },
      })
      enterChats(connection)
    } catch (authError) {
      setError(reportError('Telegram authentication failed', authError))
      setBusy(false)
      setAuthStep('credentials')
      await connection.destroy()
      if (connectionRef.current === connection) connectionRef.current = null
    }
  }

  function submitCode(code: string) {
    if (!codeResolver.current) return
    setError('')
    setBusy(true)
    const resolve = codeResolver.current
    codeResolver.current = null
    resolve(code)
  }

  function submitPassword(password: string) {
    if (!passwordResolver.current) return
    setError('')
    setBusy(true)
    const resolve = passwordResolver.current
    passwordResolver.current = null
    resolve(password)
  }

  async function enableNotifications() {
    if (typeof Notification === 'undefined') return
    try {
      setNotificationPermission(await Notification.requestPermission())
    } catch (notificationError) {
      setError(reportError('Failed to request notification permission', notificationError))
    }
  }

  async function logout() {
    const connection = connectionRef.current
    if (!connection) return
    setBusy(true)
    try {
      await connection.client.logOut()
    } catch (logoutError) {
      console.error('[Telefast] Failed to log out cleanly', logoutError)
    } finally {
      await connection.destroy()
      connectionRef.current = null
      queryClient.clear()
      setAuthStep('credentials')
      setStatus('unauthenticated')
      setBusy(false)
      location.route('/login', true)
    }
  }

  const value: TelegramContextValue = {
    status, authStep, passwordHint, deliveryLabel, busy, error, client,
    notificationPermission, beginLogin, submitCode, submitPassword, logout,
    clearError: () => setError(''), enableNotifications,
  }

  return <TelegramContext.Provider value={value}>{children}</TelegramContext.Provider>
}

export function useTelegram() {
  const value = useContext(TelegramContext)
  if (!value) throw new Error('useTelegram must be used inside TelegramProvider')
  return value
}
