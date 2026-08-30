import { createContext, type ComponentChildren } from 'preact'
import { useContext, useEffect, useRef, useState } from 'preact/hooks'
import { Long, Sticker, type Dialog, type Message, type SentCode, type StickerSet, type tl } from '@mtcute/web'
import { useLocation } from 'preact-iso'
import { createTelegramConnection, type TelefastClient } from '../telegram'

const STORAGE = {
  apiId: 'telefast.apiId',
  apiHash: 'telefast.apiHash',
}

export type AuthStep = 'credentials' | 'code' | 'password'
export type SessionStatus = 'loading' | 'unauthenticated' | 'authenticated'
type Resolver = (value: string) => void
type Connection = ReturnType<typeof createTelegramConnection>
type HistoryOffset = { id: number; date: number } | null

export interface ChatState {
  messages: Message[]
  historyOffset: HistoryOffset
  hasOlder: boolean
  loading: boolean
  loadingOlder: boolean
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
  dialogs: Dialog[]
  chats: Record<string, ChatState>
  client: TelefastClient | null
  notificationPermission: NotificationPermission | 'unsupported'
  stickerPickerLoading: boolean
  stickerPickerLoaded: boolean
  stickerPacks: StickerSet[]
  recentStickers: Sticker[]
  favoriteStickers: Sticker[]
  beginLogin(input: BeginLoginInput): Promise<void>
  submitCode(code: string): void
  submitPassword(password: string): void
  logout(): Promise<void>
  clearError(): void
  enableNotifications(): Promise<void>
  ensureDialog(peerId: string): Promise<Dialog | null>
  loadChat(peerId: string): Promise<void>
  readChat(peerId: string): Promise<void>
  loadOlder(peerId: string): Promise<void>
  sendText(peerId: string, text: string): Promise<void>
  loadStickers(): Promise<void>
  sendSticker(peerId: string, sticker: Sticker): Promise<void>
}

const TelegramContext = createContext<TelegramContextValue | null>(null)

export function dialogId(dialog: Dialog) {
  return String(dialog.peer.id)
}

export function isGroupPeer(peer: Dialog['peer']) {
  return peer.type === 'chat' && peer.isGroup
}

function isSupportedPeer(peer: Dialog['peer']) {
  return peer.type === 'user' || isGroupPeer(peer)
}

function isSupportedDialog(dialog: Dialog) {
  return isSupportedPeer(dialog.peer)
}

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

function messageText(message?: Message | null) {
  if (!message) return ''
  if (message.text) return message.text
  if (message.media?.type === 'sticker') {
    return `${message.media.emoji ? `${message.media.emoji} ` : ''}Sticker`
  }
  return message.media ? 'Attachment' : ''
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

function stickersFromRaw(documents: tl.TypeDocument[]) {
  return documents.flatMap((document) => {
    if (document._ !== 'document') return []
    const stickerAttribute = document.attributes.find(
      (attribute) => attribute._ === 'documentAttributeSticker' || attribute._ === 'documentAttributeCustomEmoji',
    )
    if (!stickerAttribute) return []
    const sizeAttribute = document.attributes.find(
      (attribute) => attribute._ === 'documentAttributeImageSize' || attribute._ === 'documentAttributeVideo',
    )
    return [new Sticker(document, stickerAttribute, sizeAttribute)]
  })
}

const EMPTY_CHAT: ChatState = {
  messages: [],
  historyOffset: null,
  hasOlder: false,
  loading: false,
  loadingOlder: false,
}

export function TelegramProvider({ children }: { children: ComponentChildren }) {
  const location = useLocation()
  const [status, setStatus] = useState<SessionStatus>('loading')
  const [authStep, setAuthStep] = useState<AuthStep>('credentials')
  const [passwordHint, setPasswordHint] = useState('')
  const [deliveryLabel, setDeliveryLabel] = useState('to your Telegram app')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dialogs, setDialogs] = useState<Dialog[]>([])
  const [chats, setChats] = useState<Record<string, ChatState>>({})
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  )
  const [stickerPickerLoading, setStickerPickerLoading] = useState(false)
  const [stickerPickerLoaded, setStickerPickerLoaded] = useState(false)
  const [stickerPacks, setStickerPacks] = useState<StickerSet[]>([])
  const [recentStickers, setRecentStickers] = useState<Sticker[]>([])
  const [favoriteStickers, setFavoriteStickers] = useState<Sticker[]>([])

  const connectionRef = useRef<Connection | null>(null)
  const codeResolver = useRef<Resolver | null>(null)
  const passwordResolver = useRef<Resolver | null>(null)
  const dialogsRef = useRef<Dialog[]>([])
  const chatsRef = useRef<Record<string, ChatState>>({})
  const loadingPeers = useRef(new Set<string>())
  const resolvingPeers = useRef(new Map<string, Promise<Dialog | null>>())

  const client = connectionRef.current?.client ?? null

  function replaceDialogs(next: Dialog[]) {
    dialogsRef.current = next
    setDialogs(next)
  }

  function updateChat(peerId: string, update: (state: ChatState) => ChatState) {
    setChats((current) => {
      const next = { ...current, [peerId]: update(current[peerId] ?? EMPTY_CHAT) }
      chatsRef.current = next
      return next
    })
  }

  async function loadDialogs(telegram = connectionRef.current?.client) {
    if (!telegram) return []
    const next: Dialog[] = []
    for await (const dialog of telegram.iterDialogs({ limit: 100 })) {
      if (isSupportedDialog(dialog)) next.push(dialog)
    }
    dialogsRef.current.forEach((dialog) => {
      const id = dialogId(dialog)
      if (chatsRef.current[id] && !next.some((item) => dialogId(item) === id)) next.push(dialog)
    })
    replaceDialogs(next)
    return next
  }

  function attachUpdates(telegram: TelefastClient) {
    telegram.onNewMessage.add((message) => {
      if (!isSupportedPeer(message.chat)) return
      const peerId = String(message.chat.id)
      updateChat(peerId, (state) => ({
        ...state,
        messages: state.messages.some((item) => item.id === message.id)
          ? state.messages
          : [...state.messages, message],
      }))

      void (async () => {
        try {
          const nextDialogs = await loadDialogs(telegram)
          const target = nextDialogs.find((dialog) => dialogId(dialog) === peerId)
          if (
            !message.isOutgoing && target && target.isMuted !== true &&
            typeof Notification !== 'undefined' && Notification.permission === 'granted' &&
            !document.hasFocus()
          ) {
            const body = isGroupPeer(target.peer) && !message.isOutgoing
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
        } catch (updateError) {
          console.error('[Telefast] Failed to process Telegram update', updateError)
        }
      })()
    })
  }

  async function enterChats(connection: Connection) {
    connectionRef.current = connection
    attachUpdates(connection.client)
    await loadDialogs(connection.client)
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
        await enterChats(connection)
      } catch {
        await connection.destroy()
        connectionRef.current = null
        if (!cancelled) setStatus('unauthenticated')
      }
    })()

    return () => {
      cancelled = true
    }
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

  async function ensureDialog(peerId: string) {
    const existing = dialogsRef.current.find((dialog) => dialogId(dialog) === peerId)
    if (existing) return existing
    const pending = resolvingPeers.current.get(peerId)
    if (pending) return pending
    const telegram = connectionRef.current?.client
    const numericPeerId = Number(peerId)
    if (!telegram || !Number.isSafeInteger(numericPeerId)) return null

    const request = telegram.getPeerDialogs([numericPeerId])
      .then(([resolved]) => {
        if (!resolved || !isSupportedDialog(resolved)) return null
        replaceDialogs([...dialogsRef.current, resolved])
        return resolved
      })
      .catch(() => null)
      .finally(() => resolvingPeers.current.delete(peerId))
    resolvingPeers.current.set(peerId, request)
    return request
  }

  async function loadChat(peerId: string) {
    if (loadingPeers.current.has(peerId)) return
    const telegram = connectionRef.current?.client
    const dialog = await ensureDialog(peerId)
    if (!telegram || !dialog) return

    loadingPeers.current.add(peerId)
    updateChat(peerId, (state) => ({ ...state, loading: true }))
    try {
      const result = await telegram.getHistory(dialog.peer, { limit: 50 })
      updateChat(peerId, (state) => ({
        ...state,
        messages: [...result].reverse(),
        historyOffset: result.next ?? null,
        hasOlder: Boolean(result.next),
        loading: false,
      }))
      await telegram.readHistory(dialog.peer)
    } catch (loadError) {
      updateChat(peerId, (state) => ({ ...state, loading: false }))
      setError(reportError('Failed to load messages', loadError))
    } finally {
      loadingPeers.current.delete(peerId)
    }
  }

  async function readChat(peerId: string) {
    const telegram = connectionRef.current?.client
    const dialog = dialogsRef.current.find((item) => dialogId(item) === peerId)
    if (!telegram || !dialog) return
    try {
      await telegram.readHistory(dialog.peer)
      await loadDialogs(telegram)
    } catch (readError) {
      console.error('[Telefast] Failed to mark chat as read', readError)
    }
  }

  async function loadOlder(peerId: string) {
    const telegram = connectionRef.current?.client
    const dialog = await ensureDialog(peerId)
    const state = chatsRef.current[peerId]
    if (!telegram || !dialog || !state?.historyOffset || state.loadingOlder) return

    updateChat(peerId, (current) => ({ ...current, loadingOlder: true }))
    try {
      const result = await telegram.getHistory(dialog.peer, { limit: 50, offset: state.historyOffset })
      const older = [...result].reverse()
      updateChat(peerId, (current) => {
        const known = new Set(current.messages.map((message) => message.id))
        return {
          ...current,
          messages: [...older.filter((message) => !known.has(message.id)), ...current.messages],
          historyOffset: result.next ?? null,
          hasOlder: Boolean(result.next),
          loadingOlder: false,
        }
      })
    } catch (loadError) {
      updateChat(peerId, (current) => ({ ...current, loadingOlder: false }))
      setError(reportError('Failed to load older messages', loadError))
    }
  }

  async function sendText(peerId: string, text: string) {
    const telegram = connectionRef.current?.client
    const dialog = await ensureDialog(peerId)
    if (!telegram || !dialog || !text.trim() || busy) return
    setBusy(true)
    try {
      const sent = await telegram.sendText(dialog.peer, text.trim())
      updateChat(peerId, (state) => ({
        ...state,
        messages: state.messages.some((message) => message.id === sent.id)
          ? state.messages : [...state.messages, sent],
      }))
      await loadDialogs(telegram)
    } catch (sendError) {
      setError(reportError('Failed to send the message', sendError))
      throw sendError
    } finally {
      setBusy(false)
    }
  }

  async function loadStickers() {
    const telegram = connectionRef.current?.client
    if (!telegram || stickerPickerLoading || stickerPickerLoaded) return
    setStickerPickerLoading(true)
    try {
      const [installed, recent, favorites] = await Promise.all([
        telegram.getInstalledStickers(),
        telegram.call({ _: 'messages.getRecentStickers', attached: false, hash: Long.ZERO }),
        telegram.call({ _: 'messages.getFavedStickers', hash: Long.ZERO }),
      ])
      const packs = await Promise.allSettled(
        installed.filter((pack) => !pack.isArchived).map((pack) => telegram.getStickerSet(pack)),
      )
      setStickerPacks(packs.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []))
      setRecentStickers(recent._ === 'messages.recentStickers' ? stickersFromRaw(recent.stickers) : [])
      setFavoriteStickers(favorites._ === 'messages.favedStickers' ? stickersFromRaw(favorites.stickers) : [])
      setStickerPickerLoaded(true)
    } catch (pickerError) {
      setError(reportError('Failed to load stickers', pickerError))
    } finally {
      setStickerPickerLoading(false)
    }
  }

  async function sendSticker(peerId: string, sticker: Sticker) {
    const telegram = connectionRef.current?.client
    const dialog = await ensureDialog(peerId)
    if (!telegram || !dialog || busy || sticker.sourceType !== 'static') return
    setBusy(true)
    try {
      const sent = await telegram.sendMedia(dialog.peer, sticker.inputMedia)
      updateChat(peerId, (state) => ({ ...state, messages: [...state.messages, sent] }))
      setRecentStickers((current) => [sticker, ...current.filter((item) => item.uniqueFileId !== sticker.uniqueFileId)])
      await loadDialogs(telegram)
    } catch (sendError) {
      setError(reportError('Failed to send sticker', sendError))
    } finally {
      setBusy(false)
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
    try {
      await connection.client.logOut()
    } catch (logoutError) {
      console.error('[Telefast] Failed to log out cleanly', logoutError)
    } finally {
      await connection.destroy()
      connectionRef.current = null
      dialogsRef.current = []
      chatsRef.current = {}
      setDialogs([])
      setChats({})
      setStickerPacks([])
      setRecentStickers([])
      setFavoriteStickers([])
      setStickerPickerLoaded(false)
      setAuthStep('credentials')
      setStatus('unauthenticated')
      setBusy(false)
      location.route('/login', true)
    }
  }

  const value: TelegramContextValue = {
    status, authStep, passwordHint, deliveryLabel, busy, error, dialogs, chats, client,
    notificationPermission, stickerPickerLoading, stickerPickerLoaded, stickerPacks,
    recentStickers, favoriteStickers, beginLogin, submitCode, submitPassword, logout,
    clearError: () => setError(''), enableNotifications, ensureDialog, loadChat, readChat, loadOlder,
    sendText, loadStickers, sendSticker,
  }

  return <TelegramContext.Provider value={value}>{children}</TelegramContext.Provider>
}

export function useTelegram() {
  const value = useContext(TelegramContext)
  if (!value) throw new Error('useTelegram must be used inside TelegramProvider')
  return value
}
