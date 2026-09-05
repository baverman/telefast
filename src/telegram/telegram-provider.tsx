import { createContext, type ComponentChildren } from 'preact'
import { useContext, useEffect, useRef, useState } from 'preact/hooks'
import type { SentCode } from '@mtcute/web'
import { QueryClient, QueryClientProvider } from '@tanstack/preact-query'
import { useLocation } from 'preact-iso'
import { createTelegramConnection, type TelefastClient } from '../telegram'
import { activeChatPeerId } from './active-chat'
import { openBlobCache, type BlobCache } from './blob-cache'
import { appendMessage, cachedDialog, telegramKeys } from './query-data'
import { setMediaStreamClient } from './media-stream'
import { isGroupPeer, isSupportedPeer, messageText } from './model'

export { dialogId, isGroupPeer } from './model'

const STORAGE = {
  apiId: 'telefast.apiId',
  apiHash: 'telefast.apiHash',
}

export type AuthStep = 'credentials' | 'code' | 'password'
export type SessionStatus = 'loading' | 'unauthenticated' | 'authenticated' | 'disconnected'
type Resolver = (value: string) => void
type Connection = ReturnType<typeof createTelegramConnection>

const CONNECTION_TIMEOUT_MS = 30_000
const RETRY_DELAY_MS = 5_000

interface AccountResources {
  accountId: string
  blobCache: BlobCache
  queryClient: QueryClient
  unsubscribeQueryCache: () => void
}

function createAccountResources(accountId: string): AccountResources {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: 1, refetchOnWindowFocus: true, gcTime: 10 * 60_000 },
      mutations: { retry: 0 },
    },
  })
  const unsubscribeQueryCache = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'removed') return
    const key = event.query.queryKey
    if (key[0] !== 'telegram' || key[1] !== 'media-url') return
    const url = event.query.state.data
    if (typeof url === 'string') URL.revokeObjectURL(url)
  })
  return { accountId, blobCache: openBlobCache(accountId), queryClient, unsubscribeQueryCache }
}

function discardAccountResources(resources: AccountResources) {
  resources.queryClient.clear()
  resources.unsubscribeQueryCache()
}

async function withConnectionTimeout<T>(operation: Promise<T>) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Telegram connection timed out after 30 seconds')), CONNECTION_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

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
  blobCache: BlobCache | null
  notificationPermission: NotificationPermission | 'unsupported'
  beginLogin(input: BeginLoginInput): Promise<void>
  submitCode(code: string): void
  submitPassword(password: string): void
  logout(): Promise<void>
  reconnect(): Promise<void>
  clearError(): void
  enableNotifications(): Promise<void>
  markRead(peerId: string): Promise<void>
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

const INVALID_SESSION_ERRORS = new Set([
  'AUTH_KEY_DUPLICATED',
  'AUTH_KEY_INVALID',
  'AUTH_KEY_PERM_EMPTY',
  'AUTH_KEY_UNREGISTERED',
  'SESSION_EXPIRED',
  'SESSION_REVOKED',
  'USER_DEACTIVATED',
  'USER_DEACTIVATED_BAN',
])

function isInvalidSessionError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const text = 'text' in error && typeof error.text === 'string'
    ? error.text
    : error instanceof Error ? error.message : ''
  return INVALID_SESSION_ERRORS.has(text)
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

export function TelegramProvider({ children, fallback }: { children: ComponentChildren; fallback: ComponentChildren }) {
  const location = useLocation()
  const [status, setStatus] = useState<SessionStatus>('loading')
  const [authStep, setAuthStep] = useState<AuthStep>('credentials')
  const [passwordHint, setPasswordHint] = useState('')
  const [deliveryLabel, setDeliveryLabel] = useState('to your Telegram app')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [resources, setResources] = useState<AccountResources | null>(null)
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  )
  const connectionRef = useRef<Connection | null>(null)
  const resourcesRef = useRef<AccountResources | null>(null)
  const recoveringConnectionRef = useRef(false)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const codeResolver = useRef<Resolver | null>(null)
  const passwordResolver = useRef<Resolver | null>(null)
  const client = connectionRef.current?.client ?? null

  function queryClient() {
    const current = resourcesRef.current?.queryClient
    if (!current) throw new Error('Telegram account resources are not ready')
    return current
  }
  function attachUpdates(telegram: TelefastClient, accountQueryClient: QueryClient) {
    telegram.onConnectionState.add((state) => {
      console.log('[Telefast] Telegram connection state:', state)
    })
    telegram.onError.add((error) => {
      console.error('[Telefast] Telegram connection error:', error)
      if (error.message === 'Worker connection expired') {
        void recoverConnection(telegram)
      }
    })
    telegram.onNewMessage.add((message) => {
      if (!isSupportedPeer(message.chat)) return
      const peerId = String(message.chat.id)
      const isCurrent = activeChatPeerId === peerId
      appendMessage(accountQueryClient, peerId, message)
      const target = cachedDialog(accountQueryClient, peerId)

      console.log('[Telefast] notification check', {
        peerId,
        isCurrent,
        isOutgoing: message.isOutgoing,
        hasTarget: Boolean(target),
        isMuted: target?.isMuted,
        notificationType: typeof Notification,
        permission: typeof Notification !== 'undefined' ? Notification.permission : 'n/a',
        visibilityState: document.visibilityState,
        hasFocus: document.hasFocus(),
      })
      if (
        !message.isOutgoing && target && target.isMuted !== true &&
        typeof Notification !== 'undefined' && Notification.permission === 'granted' &&
        (document.visibilityState !== 'visible' || !document.hasFocus() || !isCurrent)
      ) {
        const body = isGroupPeer(target.peer)
          ? `${message.sender.displayName}: ${messageText(message)}`
          : messageText(message)
        const notification = new Notification(`Telefast · ${target.peer.displayName}`, {
          body: body || 'New message',
          tag: `telefast-${peerId}`,
        })
        notification.onclick = () => {
          window.focus()
          location.route(`/chat/${encodeURIComponent(peerId)}`)
          notification.close()
        }
      }
      void accountQueryClient.invalidateQueries({ queryKey: telegramKeys.dialogs() })
    })
  }

  async function recoverConnection(failedClient: TelefastClient) {
    const current = connectionRef.current
    if (!current || current.client !== failedClient || recoveringConnectionRef.current) return

    const storedApiId = localStorage.getItem(STORAGE.apiId)
    const storedApiHash = localStorage.getItem(STORAGE.apiHash)
    if (!storedApiId || !storedApiHash) {
      setError('Telegram API credentials are missing. Please log in again.')
      setStatus('unauthenticated')
      return
    }

    recoveringConnectionRef.current = true
    setStatus('loading')
    setMediaStreamClient(null)
    console.log('[Telefast] Recreating expired Telegram worker connection')
    let replacement: Connection | null = null

    try {
      await current.destroy()
      if (connectionRef.current !== current) return

      replacement = createTelegramConnection(Number(storedApiId), storedApiHash)
      connectionRef.current = replacement
      await withConnectionTimeout(replacement.client.start({}))
      if (connectionRef.current !== replacement) {
        await replacement.destroy()
        return
      }

      await enterChats(replacement)
      await queryClient().invalidateQueries({ queryKey: telegramKeys.all })
      console.log('[Telefast] Telegram worker connection restored')
    } catch (recoveryError) {
      if (replacement) await replacement.destroy().catch(() => undefined)
      if (connectionRef.current === current || connectionRef.current === replacement) {
        connectionRef.current = null
      }
      const invalidSession = isInvalidSessionError(recoveryError)
      setError(reportError('Failed to restore Telegram connection', recoveryError))
      setStatus(invalidSession ? 'unauthenticated' : 'disconnected')
      if (!invalidSession) scheduleReconnect()
    } finally {
      recoveringConnectionRef.current = false
    }
  }

  function scheduleReconnect() {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null
      void reconnect()
    }, RETRY_DELAY_MS)
  }
  async function enterChats(connection: Connection) {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
    connectionRef.current = connection
    const accountId = String((await connection.client.getMe()).id)
    let accountResources = resourcesRef.current
    if (!accountResources || accountResources.accountId !== accountId) {
      if (accountResources) discardAccountResources(accountResources)
      accountResources = createAccountResources(accountId)
      resourcesRef.current = accountResources
      setResources(accountResources)
    }
    setMediaStreamClient(connection.client)
    attachUpdates(connection.client, accountResources.queryClient)
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
        await withConnectionTimeout(connection.client.start({}))
        if (cancelled) {
          await connection.destroy()
          return
        }
        await enterChats(connection)
      } catch (startupError) {
        await connection.destroy()
        connectionRef.current = null
        if (!cancelled) {
          setError(reportError('Failed to connect to Telegram', startupError))
          setStatus(isInvalidSessionError(startupError) ? 'unauthenticated' : 'disconnected')
        }
      }
    })()
    return () => {
      cancelled = true
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (status === 'unauthenticated' && location.path !== '/login') location.route('/login', true)
  }, [status, location.path])

  async function reconnect() {
    if (recoveringConnectionRef.current) return

    const storedApiId = localStorage.getItem(STORAGE.apiId)
    const storedApiHash = localStorage.getItem(STORAGE.apiHash)
    if (!storedApiId || !storedApiHash) {
      setStatus('unauthenticated')
      return
    }

    recoveringConnectionRef.current = true
    setStatus('loading')
    setError('')
    const connection = createTelegramConnection(Number(storedApiId), storedApiHash)
    connectionRef.current = connection
    try {
      await withConnectionTimeout(connection.client.start({}))
      if (connectionRef.current !== connection) {
        await connection.destroy()
        return
      }
      await enterChats(connection)
      await queryClient().invalidateQueries({ queryKey: telegramKeys.all })
    } catch (connectionError) {
      await connection.destroy().catch(() => undefined)
      if (connectionRef.current === connection) connectionRef.current = null
      const invalidSession = isInvalidSessionError(connectionError)
      setError(reportError('Failed to connect to Telegram', connectionError))
      setStatus(invalidSession ? 'unauthenticated' : 'disconnected')
      if (!invalidSession) scheduleReconnect()
    } finally {
      recoveringConnectionRef.current = false
    }
  }

  async function beginLogin(input: BeginLoginInput) {
    setError('')
    localStorage.setItem(STORAGE.apiId, String(input.apiId))
    localStorage.setItem(STORAGE.apiHash, input.apiHash)
    setBusy(true)
    setMediaStreamClient(null)
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
      await enterChats(connection)
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


  async function markRead(peerId: string) {
    const telegram = connectionRef.current?.client
    const dialog = cachedDialog(queryClient(), peerId)
    if (!telegram || !dialog) return
    try {
      await telegram.readHistory(dialog.peer)
      await queryClient().invalidateQueries({ queryKey: telegramKeys.dialogs() })
    } catch (error) {
      console.error('[Telefast] Failed to mark chat as read', error)
    }
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
    setMediaStreamClient(null)
    try {
      await connection.client.logOut()
    } catch (logoutError) {
      console.error('[Telefast] Failed to log out cleanly', logoutError)
    } finally {
      await connection.destroy()
      connectionRef.current = null
      const currentResources = resourcesRef.current
      if (currentResources) discardAccountResources(currentResources)
      resourcesRef.current = null
      setResources(null)
      setAuthStep('credentials')
      setStatus('unauthenticated')
      setBusy(false)
      location.route('/login', true)
    }
  }

  const value: TelegramContextValue = {
    status, authStep, passwordHint, deliveryLabel, busy, error, client,
    blobCache: resources?.blobCache ?? null,
    notificationPermission, beginLogin, submitCode, submitPassword, logout, reconnect,
    clearError: () => setError(''), enableNotifications, markRead,
  }

  const content = status === 'authenticated' && resources
    ? <QueryClientProvider client={resources.queryClient}>{children}</QueryClientProvider>
    : fallback

  return <TelegramContext.Provider value={value}>{content}</TelegramContext.Provider>
}

export function useTelegram() {
  const value = useContext(TelegramContext)
  if (!value) throw new Error('useTelegram must be used inside TelegramProvider')
  return value
}
