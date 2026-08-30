import type { ComponentChildren } from 'preact'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { Long, Sticker, type Dialog, type Message, type SentCode, type StickerSet, type tl } from '@mtcute/web'
import { useLocation } from 'preact-iso'
import { createTelegramConnection, type TelefastClient } from './telegram'

const STORAGE = {
  apiId: 'telefast.apiId',
  apiHash: 'telefast.apiHash',
}

type Screen = 'loading' | 'auth' | 'chats'
type AuthStep = 'credentials' | 'code' | 'password'
type Resolver = (value: string) => void

type Connection = ReturnType<typeof createTelegramConnection>

type StickerTab = 'recent' | 'favorites' | string

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

function dialogId(dialog: Dialog) {
  return String(dialog.peer.id)
}

function chatIdFromPath(path: string) {
  const match = /^\/chat\/([^/]+)\/?$/.exec(path)
  return match ? decodeURIComponent(match[1]) : ''
}

function isKnownPath(path: string) {
  return path === '/' || path === '/login' || Boolean(chatIdFromPath(path))
}

function initials(name = '?') {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

function timeLabel(date?: Date | null) {
  if (!date) return ''
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function messageText(message?: Message | null) {
  if (!message) return ''
  if (message.text) return message.text
  if (message.media?.type === 'sticker') {
    return `${message.media.emoji ? `${message.media.emoji} ` : ''}Sticker`
  }
  return message.media ? 'Attachment' : ''
}

type TelegramMessageEntity = Message['entities'][number]

function normalizeWebUrl(value: string) {
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`
  try {
    const url = new URL(candidate)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : ''
  } catch {
    return ''
  }
}

function entityHref(entity: TelegramMessageEntity, text: string) {
  if (entity.is('url')) return normalizeWebUrl(text)
  if (entity.is('text_link')) {
    const webUrl = normalizeWebUrl(entity.params.url)
    if (webUrl) return webUrl
    try {
      const url = new URL(entity.params.url)
      return ['tg:', 'mailto:', 'tel:'].includes(url.protocol) ? url.href : ''
    } catch {
      return ''
    }
  }
  if (entity.is('email')) return `mailto:${text}`
  if (entity.is('phone_number')) return `tel:${text.replaceAll(/[^\d+]/g, '')}`
  return ''
}

function MessageText({ message }: { message: Message }) {
  const parts: ComponentChildren[] = []
  let cursor = 0
  const entities = [...message.entities].sort((left, right) => left.offset - right.offset)

  entities.forEach((entity) => {
    if (entity.offset < cursor) return
    const text = message.text.slice(entity.offset, entity.offset + entity.length)
    const href = entityHref(entity, text)
    if (!href) return

    if (entity.offset > cursor) parts.push(message.text.slice(cursor, entity.offset))
    const opensNewTab = href.startsWith('http:') || href.startsWith('https:')
    parts.push(
      <a
        key={`${entity.offset}-${entity.length}`}
        class="text-sky-300 underline decoration-sky-400/60 underline-offset-2 hover:text-sky-200"
        href={href}
        target={opensNewTab ? '_blank' : undefined}
        rel={opensNewTab ? 'noopener noreferrer' : undefined}
      >
        {text}
      </a>,
    )
    cursor = entity.offset + entity.length
  })

  if (cursor < message.text.length) parts.push(message.text.slice(cursor))
  return <>{parts}</>
}

function isGroupPeer(peer: Dialog['peer']) {
  return peer.type === 'chat' && peer.isGroup
}

function isSupportedPeer(peer: Dialog['peer']) {
  return peer.type === 'user' || isGroupPeer(peer)
}

function isSupportedDialog(dialog: Dialog) {
  return isSupportedPeer(dialog.peer)
}

function messagePreview(message?: Message | null, includeSender = false) {
  const text = messageText(message)
  if (!message || !text || !includeSender || message.isOutgoing) return text
  return `${message.sender.displayName}: ${text}`
}

function codeDeliveryLabel(sentCode: SentCode) {
  switch (sentCode.type) {
    case 'app':
      return 'to your Telegram app'
    case 'sms':
    case 'sms_phrase':
    case 'sms_word':
      return 'by SMS'
    case 'email':
      return 'by email'
    case 'call':
    case 'flash_call':
    case 'missed_call':
      return 'by phone call'
    default:
      return `through ${sentCode.type.replaceAll('_', ' ')}`
  }
}

const avatarUrls = new Map<string, string>()
const avatarRequests = new Map<string, Promise<string>>()
let avatarCacheGeneration = 0

function clearAvatarCache() {
  avatarCacheGeneration += 1
  avatarUrls.forEach((url) => URL.revokeObjectURL(url))
  avatarUrls.clear()
  avatarRequests.clear()
}

function requestAvatar(telegram: TelefastClient, peer: Dialog['peer']) {
  const photo = peer.photo
  if (!photo) return Promise.resolve('')

  const key = photo.small.uniqueFileId
  const cached = avatarUrls.get(key)
  if (cached) return Promise.resolve(cached)

  const pending = avatarRequests.get(key)
  if (pending) return pending

  const requestGeneration = avatarCacheGeneration
  const request = telegram
    .downloadAsBuffer(photo.small)
    .then((bytes) => {
      if (requestGeneration !== avatarCacheGeneration) return ''
      const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: 'image/jpeg' }))
      avatarUrls.set(key, url)
      avatarRequests.delete(key)
      return url
    })
    .catch((error) => {
      avatarRequests.delete(key)
      throw error
    })
  avatarRequests.set(key, request)
  return request
}

function Avatar({
  peer,
  telegram,
  className,
}: {
  peer: Dialog['peer']
  telegram: TelefastClient | null
  className: string
}) {
  const hostRef = useRef<HTMLSpanElement | null>(null)
  const photoKey = peer.photo?.small.uniqueFileId ?? ''
  const [source, setSource] = useState(() => avatarUrls.get(photoKey) ?? '')

  useEffect(() => {
    setSource(avatarUrls.get(photoKey) ?? '')
    if (!telegram || !photoKey || !peer.photo) return

    let active = true
    const load = () => {
      void requestAvatar(telegram, peer)
        .then((url) => {
          if (active) setSource(url)
        })
        .catch((error) => console.warn('[Telefast] Failed to load avatar', error))
    }

    const host = hostRef.current
    if (!host || typeof IntersectionObserver === 'undefined') {
      load()
      return () => {
        active = false
      }
    }

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      load()
    }, { rootMargin: '160px' })
    observer.observe(host)

    return () => {
      active = false
      observer.disconnect()
    }
  }, [photoKey, telegram, peer])

  return (
    <span ref={hostRef} class={`${className} overflow-hidden`} aria-hidden="true">
      {source ? (
        <img class="size-full object-cover" src={source} alt="" decoding="async" />
      ) : (
        initials(peer.displayName)
      )}
    </span>
  )
}

type StickerMedia = Extract<NonNullable<Message['media']>, { type: 'sticker' }>

function StickerView({
  sticker,
  telegram,
  compact = false,
  largePreview = false,
}: {
  sticker: StickerMedia
  telegram: TelefastClient | null
  compact?: boolean
  largePreview?: boolean
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [source, setSource] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!telegram) return

    let active = true
    let objectUrl = ''
    let destroyAnimation = () => {}

    const load = async () => {
      try {
        const bytes = await telegram.downloadAsBuffer(sticker)
        if (!active) return

        if (sticker.sourceType === 'static' || sticker.sourceType === 'video') {
          const mimeType = sticker.sourceType === 'video' ? 'video/webm' : 'image/webp'
          objectUrl = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: mimeType }))
          setSource(objectUrl)
          return
        }

        const compressed = new Blob([Uint8Array.from(bytes)]).stream()
        const animationData = await new Response(
          compressed.pipeThrough(new DecompressionStream('gzip')),
        ).json()
        const { default: lottie } = await import('lottie-web/build/player/lottie_light')
        if (!active || !hostRef.current) return

        const animation = lottie.loadAnimation({
          container: hostRef.current,
          renderer: 'svg',
          loop: true,
          autoplay: true,
          animationData,
        })
        destroyAnimation = () => animation.destroy()
      } catch (error) {
        if (active) {
          console.warn('[Telefast] Failed to load sticker', error)
          setFailed(true)
        }
      }
    }

    const host = hostRef.current
    if (!host || typeof IntersectionObserver === 'undefined') {
      void load()
    } else {
      const observer = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        observer.disconnect()
        void load()
      }, { rootMargin: '240px' })
      observer.observe(host)
      destroyAnimation = () => observer.disconnect()
    }

    return () => {
      active = false
      destroyAnimation()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [sticker, telegram])

  const label = `${sticker.emoji ? `${sticker.emoji} ` : ''}Sticker`

  return (
    <div
      ref={hostRef}
      class={compact
        ? `grid aspect-square place-items-center overflow-hidden ${largePreview ? 'size-48' : 'size-16'}`
        : 'grid aspect-square w-48 max-w-[60vw] place-items-center overflow-hidden md:w-60'
      }
      role="img"
      aria-label={label}
    >
      {sticker.sourceType === 'static' && source && (
        <img class="size-full object-contain" src={source} alt={label} decoding="async" />
      )}
      {sticker.sourceType === 'video' && source && (
        <video class="size-full object-contain" src={source} autoPlay loop muted playsInline aria-label={label} />
      )}
      {failed && <span class="text-sm text-zinc-400">{label}</span>}
    </div>
  )
}

export function App() {
  const location = useLocation()
  const selectedId = chatIdFromPath(location.path)
  const [screen, setScreen] = useState<Screen>('loading')
  const [authStep, setAuthStep] = useState<AuthStep>('credentials')
  const [apiId, setApiId] = useState(localStorage.getItem(STORAGE.apiId) ?? '')
  const [apiHash, setApiHash] = useState(localStorage.getItem(STORAGE.apiHash) ?? '')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [passwordHint, setPasswordHint] = useState('')
  const [deliveryLabel, setDeliveryLabel] = useState('to your Telegram app')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dialogs, setDialogs] = useState<Dialog[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [search, setSearch] = useState('')
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [historyOffset, setHistoryOffset] = useState<{ id: number; date: number } | null>(null)
  const [hasOlderMessages, setHasOlderMessages] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [stickerPickerOpen, setStickerPickerOpen] = useState(false)
  const [stickerPickerLoading, setStickerPickerLoading] = useState(false)
  const [stickerPacks, setStickerPacks] = useState<StickerSet[]>([])
  const [recentStickers, setRecentStickers] = useState<Sticker[]>([])
  const [favoriteStickers, setFavoriteStickers] = useState<Sticker[]>([])
  const [stickerTab, setStickerTab] = useState<StickerTab>('recent')
  const [stickerSearch, setStickerSearch] = useState('')
  const [stickerPickerLoaded, setStickerPickerLoaded] = useState(false)
  const [largeStickerPreviews, setLargeStickerPreviews] = useState(false)
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  )

  const connectionRef = useRef<Connection | null>(null)
  const codeResolver = useRef<Resolver | null>(null)
  const passwordResolver = useRef<Resolver | null>(null)
  const selectedRef = useRef<Dialog | null>(null)
  const messageEndRef = useRef<HTMLDivElement | null>(null)
  const shouldScrollBottomRef = useRef(true)
  const resolvingRouteRef = useRef('')

  const selected = useMemo(
    () => dialogs.find((dialog) => dialogId(dialog) === selectedId),
    [dialogs, selectedId],
  )

  const messagesForSelected =
    selectedRef.current && dialogId(selectedRef.current) === selectedId ? messages : []

  const visibleDialogs = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return dialogs
    return dialogs.filter((dialog) => dialog.peer.displayName.toLowerCase().includes(query))
  }, [dialogs, search])

  const pickerStickers = useMemo(() => {
    const query = stickerSearch.trim().toLowerCase()
    let stickers: Sticker[]

    if (query) {
      stickers = stickerPacks.flatMap((pack) => {
        const packMatches = pack.title.toLowerCase().includes(query) || pack.shortName.toLowerCase().includes(query)
        return pack.stickers
          .filter((info) => packMatches || info.emoji.includes(stickerSearch.trim()))
          .map((info) => info.sticker)
      })
    } else if (stickerTab === 'recent') {
      stickers = recentStickers
    } else if (stickerTab === 'favorites') {
      stickers = favoriteStickers
    } else {
      stickers = stickerPacks
        .find((pack) => pack.shortName === stickerTab)
        ?.stickers.map((info) => info.sticker) ?? []
    }

    return [...new Map(stickers.map((sticker) => [sticker.uniqueFileId, sticker])).values()]
  }, [stickerSearch, stickerTab, stickerPacks, recentStickers, favoriteStickers])

  function client() {
    return connectionRef.current?.client ?? null
  }

  async function loadMessages(dialog: Dialog, telegram = client()) {
    if (!telegram) return
    setLoadingMessages(true)
    shouldScrollBottomRef.current = true
    try {
      const result = await telegram.getHistory(dialog.peer, { limit: 50 })
      setMessages([...result].reverse())
      setHistoryOffset(result.next ?? null)
      setHasOlderMessages(Boolean(result.next))
      await telegram.readHistory(dialog.peer)
    } catch (loadError) {
      setError(reportError('Failed to load messages', loadError))
    } finally {
      setLoadingMessages(false)
    }
  }

  async function loadOlderMessages() {
    const telegram = client()
    const dialog = selectedRef.current
    if (!telegram || !dialog || !historyOffset || loadingOlder) return

    setLoadingOlder(true)
    shouldScrollBottomRef.current = false
    try {
      const result = await telegram.getHistory(dialog.peer, {
        limit: 50,
        offset: historyOffset,
      })
      const older = [...result].reverse()
      setMessages((current) => {
        const known = new Set(current.map((message) => message.id))
        return [...older.filter((message) => !known.has(message.id)), ...current]
      })
      setHistoryOffset(result.next ?? null)
      setHasOlderMessages(Boolean(result.next))
    } catch (loadError) {
      setError(reportError('Failed to load older messages', loadError))
    } finally {
      setLoadingOlder(false)
    }
  }

  async function loadDialogs(telegram = client()) {
    if (!telegram) return

    const nextDialogs: Dialog[] = []
    for await (const dialog of telegram.iterDialogs({ limit: 100 })) {
      if (isSupportedDialog(dialog)) nextDialogs.push(dialog)
    }
    setDialogs(nextDialogs)

    const activeId = selectedRef.current ? dialogId(selectedRef.current) : ''
    if (activeId) {
      selectedRef.current =
        nextDialogs.find((dialog) => dialogId(dialog) === activeId) ?? null
    }
    return nextDialogs
  }

  function attachUpdates(telegram: TelefastClient) {
    telegram.onNewMessage.add((message) => {
      if (!isSupportedPeer(message.chat)) return

      void (async () => {
        try {
          const nextDialogs = await loadDialogs(telegram)
          const targetDialog = nextDialogs?.find((dialog) => dialog.peer.id === message.chat.id)
          const active = selectedRef.current

          if (active && active.peer.id === message.chat.id) {
            shouldScrollBottomRef.current = true
            setMessages((current) =>
              current.some((item) => item.id === message.id) ? current : [...current, message],
            )
            await telegram.readHistory(active.peer)
          }

          const shouldNotify =
            !message.isOutgoing &&
            targetDialog &&
            targetDialog.isMuted !== true &&
            typeof Notification !== 'undefined' &&
            Notification.permission === 'granted' &&
            (!document.hasFocus() || active?.peer.id !== message.chat.id)

          if (shouldNotify) {
            const notification = new Notification(targetDialog.peer.displayName, {
              body: messagePreview(message, isGroupPeer(targetDialog.peer)) || 'New message',
              tag: `telefast-${message.chat.id}`,
            })
            notification.onclick = () => {
              window.focus()
              void selectDialog(targetDialog)
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
    setScreen('chats')
    if (location.path === '/login' || !isKnownPath(location.path)) {
      location.route('/', true)
    }
    setBusy(false)
  }

  useEffect(() => {
    let cancelled = false

    // Remove the obsolete GramJS string session. mtcute stores its session in IndexedDB.
    localStorage.removeItem('telefast.session')

    async function restoreSession() {
      const storedApiId = localStorage.getItem(STORAGE.apiId)
      const storedApiHash = localStorage.getItem(STORAGE.apiHash)

      if (!storedApiId || !storedApiHash) {
        setScreen('auth')
        location.route('/login', true)
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
        if (!cancelled) {
          setScreen('auth')
          location.route('/login', true)
        }
      }
    }

    void restoreSession()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (screen !== 'chats') return

    if (location.path === '/') {
      selectedRef.current = null
      setMessages([])
      setHistoryOffset(null)
      setHasOlderMessages(false)
      return
    }

    if (location.path === '/login' || !isKnownPath(location.path)) {
      location.route('/', true)
      return
    }

    const routedId = chatIdFromPath(location.path)
    const dialog = dialogs.find((item) => dialogId(item) === routedId)
    if (dialog) {
      if (!selectedRef.current || dialogId(selectedRef.current) !== routedId) {
        selectedRef.current = dialog
        setMessages([])
        setHistoryOffset(null)
        setHasOlderMessages(false)
        setError('')
        void loadMessages(dialog)
      }
      return
    }

    if (resolvingRouteRef.current === routedId) return
    const peerId = Number(routedId)
    if (!Number.isSafeInteger(peerId)) {
      location.route('/', true)
      return
    }

    const telegram = client()
    if (!telegram) return
    resolvingRouteRef.current = routedId
    void telegram
      .getPeerDialogs([peerId])
      .then(([resolved]) => {
        if (resolved && isSupportedDialog(resolved)) {
          setDialogs((current) =>
            current.some((item) => dialogId(item) === routedId) ? current : [...current, resolved],
          )
        } else {
          location.route('/', true)
        }
      })
      .catch((routeError) => {
        setError(reportError('Failed to open the routed chat', routeError))
        location.route('/', true)
      })
      .finally(() => {
        resolvingRouteRef.current = ''
      })
  }, [screen, location.path, dialogs])

  useEffect(() => {
    setStickerPickerOpen(false)
  }, [location.path])

  useEffect(() => {
    if (!stickerPickerOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setStickerPickerOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [stickerPickerOpen])

  useEffect(() => {
    if (shouldScrollBottomRef.current) {
      messageEndRef.current?.scrollIntoView({ block: 'end' })
    }
    shouldScrollBottomRef.current = true
  }, [messages])

  async function enableNotifications() {
    if (typeof Notification === 'undefined') return
    try {
      setNotificationPermission(await Notification.requestPermission())
    } catch (notificationError) {
      setError(reportError('Failed to request notification permission', notificationError))
    }
  }

  async function beginAuthentication(event: SubmitEvent) {
    event.preventDefault()
    setError('')

    const parsedApiId = Number(apiId)
    if (!Number.isInteger(parsedApiId) || !apiHash.trim() || !phone.trim()) {
      setError('Enter a valid API ID, API hash, and phone number.')
      return
    }

    localStorage.setItem(STORAGE.apiId, String(parsedApiId))
    localStorage.setItem(STORAGE.apiHash, apiHash.trim())
    setBusy(true)

    if (connectionRef.current) await connectionRef.current.destroy()
    const connection = createTelegramConnection(parsedApiId, apiHash.trim())
    connectionRef.current = connection

    try {
      await connection.client.start({
        phone: phone.trim(),
        codeSentCallback: (sentCode) => {
          setDeliveryLabel(codeDeliveryLabel(sentCode))
        },
        code: async () => {
          setCode('')
          setAuthStep('code')
          setBusy(false)
          return new Promise<string>((resolve) => {
            codeResolver.current = resolve
          })
        },
        password: async () => {
          setPassword('')
          setPasswordHint((await connection.client.getPasswordHint()) ?? '')
          setAuthStep('password')
          setBusy(false)
          return new Promise<string>((resolve) => {
            passwordResolver.current = resolve
          })
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

  function submitCode(event: SubmitEvent) {
    event.preventDefault()
    if (!code.trim() || !codeResolver.current) return
    setError('')
    setBusy(true)
    const resolve = codeResolver.current
    codeResolver.current = null
    resolve(code.trim())
  }

  function submitPassword(event: SubmitEvent) {
    event.preventDefault()
    if (!password || !passwordResolver.current) return
    setError('')
    setBusy(true)
    const resolve = passwordResolver.current
    passwordResolver.current = null
    resolve(password)
  }

  function selectDialog(dialog: Dialog) {
    location.route(`/chat/${encodeURIComponent(dialogId(dialog))}`)
  }

  async function loadStickerPicker() {
    const telegram = client()
    if (!telegram || stickerPickerLoading || stickerPickerLoaded) return

    setStickerPickerLoading(true)
    try {
      const [installed, recent, favorites] = await Promise.all([
        telegram.getInstalledStickers(),
        telegram.call({ _: 'messages.getRecentStickers', attached: false, hash: Long.ZERO }),
        telegram.call({ _: 'messages.getFavedStickers', hash: Long.ZERO }),
      ])
      const packResults = await Promise.allSettled(
        installed.filter((pack) => !pack.isArchived).map((pack) => telegram.getStickerSet(pack)),
      )
      setStickerPacks(
        packResults.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []),
      )
      setRecentStickers(recent._ === 'messages.recentStickers' ? stickersFromRaw(recent.stickers) : [])
      setFavoriteStickers(favorites._ === 'messages.favedStickers' ? stickersFromRaw(favorites.stickers) : [])
      setStickerPickerLoaded(true)
    } catch (pickerError) {
      setError(reportError('Failed to load stickers', pickerError))
    } finally {
      setStickerPickerLoading(false)
    }
  }

  function toggleStickerPicker() {
    const nextOpen = !stickerPickerOpen
    setStickerPickerOpen(nextOpen)
    if (nextOpen) void loadStickerPicker()
  }

  async function sendSticker(sticker: Sticker) {
    const telegram = client()
    const dialog = selectedRef.current
    if (!telegram || !dialog || busy || sticker.sourceType !== 'static') return

    setBusy(true)
    shouldScrollBottomRef.current = true
    try {
      const sent = await telegram.sendMedia(dialog.peer, sticker.inputMedia)
      setMessages((current) =>
        current.some((message) => message.id === sent.id) ? current : [...current, sent],
      )
      setRecentStickers((current) => [
        sticker,
        ...current.filter((item) => item.uniqueFileId !== sticker.uniqueFileId),
      ])
      setStickerPickerOpen(false)
      await loadDialogs(telegram)
    } catch (sendError) {
      setError(reportError('Failed to send sticker', sendError))
    } finally {
      setBusy(false)
    }
  }

  async function sendMessage(event: SubmitEvent) {
    event.preventDefault()
    const telegram = client()
    const dialog = selectedRef.current
    const text = draft.trim()
    if (!telegram || !dialog || !text || busy) return

    setDraft('')
    setBusy(true)
    shouldScrollBottomRef.current = true
    try {
      const sent = await telegram.sendText(dialog.peer, text)
      setMessages((current) =>
        current.some((message) => message.id === sent.id) ? current : [...current, sent],
      )
      await loadDialogs(telegram)
    } catch (sendError) {
      setDraft(text)
      setError(reportError('Failed to send the message', sendError))
    } finally {
      setBusy(false)
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
      clearAvatarCache()
      selectedRef.current = null
      setDialogs([])
      setMessages([])
      setStickerPickerOpen(false)
      setStickerPickerLoaded(false)
      setStickerPacks([])
      setRecentStickers([])
      setFavoriteStickers([])
      setAuthStep('credentials')
      setScreen('auth')
      location.route('/login', true)
      setBusy(false)
    }
  }

  if (screen === 'loading') {
    return (
      <main class="grid min-h-screen place-items-center bg-zinc-950 text-zinc-100">
        <div class="flex items-center gap-3 text-sm text-zinc-400">
          <span class="loader" /> Connecting to Telegram
        </div>
      </main>
    )
  }

  if (screen === 'auth') {
    return (
      <main class="grid min-h-screen place-items-center bg-zinc-950 p-5 text-zinc-100">
        <section class="w-full max-w-md rounded-3xl border border-zinc-800 bg-zinc-900 p-7 shadow-2xl shadow-black/40">
          <div class="mb-8">
            <div class="mb-4 grid size-12 place-items-center rounded-2xl bg-sky-500 text-xl font-bold text-white">
              T
            </div>
            <h1 class="text-2xl font-semibold tracking-tight">Telefast</h1>
            <p class="mt-2 text-sm leading-6 text-zinc-400">
              A direct, lightweight Telegram client. Data stays in this browser.
            </p>
          </div>

          {authStep === 'credentials' && (
            <form class="space-y-4" onSubmit={beginAuthentication}>
              <label class="field">
                <span>API ID</span>
                <input
                  inputMode="numeric"
                  autocomplete="off"
                  value={apiId}
                  onInput={(event) => setApiId(event.currentTarget.value)}
                  placeholder="12345678"
                />
              </label>
              <label class="field">
                <span>API hash</span>
                <input
                  autocomplete="off"
                  value={apiHash}
                  onInput={(event) => setApiHash(event.currentTarget.value)}
                  placeholder="From my.telegram.org"
                />
              </label>
              <label class="field">
                <span>Phone number</span>
                <input
                  type="tel"
                  autocomplete="tel"
                  value={phone}
                  onInput={(event) => setPhone(event.currentTarget.value)}
                  placeholder="+1 555 000 0000"
                />
              </label>
              <button class="primary-button" disabled={busy} type="submit">
                {busy ? 'Connecting…' : 'Continue'}
              </button>
              <p class="text-center text-xs leading-5 text-zinc-500">
                Create application credentials at my.telegram.org.
              </p>
            </form>
          )}

          {authStep === 'code' && (
            <form class="space-y-4" onSubmit={submitCode}>
              <div>
                <h2 class="font-medium">Enter the login code</h2>
                <p class="mt-1 text-sm text-zinc-400">Sent {deliveryLabel}.</p>
              </div>
              <label class="field">
                <span>Code</span>
                <input
                  inputMode="numeric"
                  autocomplete="one-time-code"
                  autofocus
                  value={code}
                  onInput={(event) => setCode(event.currentTarget.value)}
                  placeholder="12345"
                />
              </label>
              <button class="primary-button" disabled={busy || !code.trim()} type="submit">
                {busy ? 'Checking…' : 'Sign in'}
              </button>
            </form>
          )}

          {authStep === 'password' && (
            <form class="space-y-4" onSubmit={submitPassword}>
              <div>
                <h2 class="font-medium">Two-step verification</h2>
                <p class="mt-1 text-sm text-zinc-400">
                  {passwordHint ? `Hint: ${passwordHint}` : 'Enter your Telegram password.'}
                </p>
              </div>
              <label class="field">
                <span>Password</span>
                <input
                  type="password"
                  autocomplete="current-password"
                  autofocus
                  value={password}
                  onInput={(event) => setPassword(event.currentTarget.value)}
                />
              </label>
              <button class="primary-button" disabled={busy || !password} type="submit">
                {busy ? 'Checking…' : 'Continue'}
              </button>
            </form>
          )}

          {error && (
            <p role="alert" class="mt-4 rounded-xl border border-red-900/50 bg-red-950/40 px-4 py-3 text-sm text-red-300">
              {error}
            </p>
          )}
        </section>
      </main>
    )
  }

  return (
    <main class="flex h-screen overflow-hidden bg-zinc-950 text-zinc-100">
      <aside class={`${selected ? 'hidden md:flex' : 'flex'} w-full shrink-0 flex-col border-r border-zinc-800 bg-zinc-900 md:w-88`}>
        <header class="flex h-16 items-center gap-2 border-b border-zinc-800 px-4">
          <strong class="mr-auto tracking-tight">Telefast</strong>
          {notificationPermission !== 'unsupported' && (
            <button
              class="icon-button px-2 text-xs"
              disabled={notificationPermission === 'denied'}
              onClick={() => void enableNotifications()}
              title={notificationPermission === 'denied' ? 'Notifications are blocked in browser settings' : 'Enable desktop notifications'}
            >
              {notificationPermission === 'granted' ? 'Alerts on' : notificationPermission === 'denied' ? 'Alerts blocked' : 'Enable alerts'}
            </button>
          )}
          <button class="icon-button px-2 text-xs" disabled={busy} onClick={logout} title="Log out">
            Exit
          </button>
        </header>
        <div class="p-3">
          <input
            class="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-2.5 text-sm outline-none placeholder:text-zinc-600 focus:border-sky-500"
            value={search}
            onInput={(event) => setSearch(event.currentTarget.value)}
            placeholder="Search chats"
          />
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {visibleDialogs.map((dialog) => {
            const id = dialogId(dialog)
            const title = dialog.peer.displayName
            return (
              <a
                key={id}
                href={`/chat/${encodeURIComponent(id)}`}
                class={`flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors ${selectedId === id ? 'bg-sky-500/15' : 'hover:bg-zinc-800/70'}`}
              >
                <Avatar
                  peer={dialog.peer}
                  telegram={connectionRef.current?.client ?? null}
                  className="grid size-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-sky-500 to-indigo-500 text-sm font-semibold text-white"
                />
                <span class="min-w-0 flex-1">
                  <span class="flex items-baseline gap-2">
                    <strong class="min-w-0 flex-1 truncate text-sm font-medium">{title}</strong>
                    <time class="text-[11px] text-zinc-500">{timeLabel(dialog.lastMessage?.date)}</time>
                  </span>
                  <span class="mt-1 flex items-center gap-2">
                    <span class="min-w-0 flex-1 truncate text-xs text-zinc-500">
                      {messagePreview(dialog.lastMessage, isGroupPeer(dialog.peer))}
                    </span>
                    {dialog.unreadCount > 0 && (
                      <span class="min-w-5 rounded-full bg-sky-500 px-1.5 py-0.5 text-center text-[10px] font-bold text-white">
                        {dialog.unreadCount}
                      </span>
                    )}
                  </span>
                </span>
              </a>
            )
          })}
          {!visibleDialogs.length && (
            <p class="px-4 py-8 text-center text-sm text-zinc-500">No chats found.</p>
          )}
        </div>
      </aside>

      <section class={`${selected ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 flex-col bg-chat`}>
        {selected ? (
          <>
            <header class="flex h-16 shrink-0 items-center gap-3 border-b border-zinc-800 bg-zinc-900/90 px-4 backdrop-blur">
              <a
                class="icon-button md:hidden"
                href="/"
                aria-label="Back to chats"
              >
                ←
              </a>
              <Avatar
                peer={selected.peer}
                telegram={connectionRef.current?.client ?? null}
                className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-sky-500 to-indigo-500 text-xs font-semibold"
              />
              <strong class="truncate text-sm font-medium">{selected.peer.displayName}</strong>
            </header>

            <div class="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-8">
              <div class="mx-auto flex min-h-full max-w-3xl flex-col justify-end gap-2">
                {hasOlderMessages && (
                  <button
                    class="mx-auto mb-4 rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                    disabled={loadingOlder}
                    onClick={() => void loadOlderMessages()}
                  >
                    {loadingOlder ? 'Loading…' : 'Load older messages'}
                  </button>
                )}
                {loadingMessages && !messagesForSelected.length && (
                  <p class="my-auto text-center text-sm text-zinc-500">Loading messages…</p>
                )}
                {messagesForSelected.map((message) => (
                  <article
                    key={message.id}
                    class={message.media?.type === 'sticker'
                      ? `sticker-message ${message.isOutgoing ? 'sticker-out' : 'sticker-in'}`
                      : `message-bubble ${message.isOutgoing ? 'message-out' : 'message-in'}`
                    }
                  >
                    {isGroupPeer(selected.peer) && !message.isOutgoing && (
                      <p class="mb-1 text-xs font-medium text-sky-300">{message.sender.displayName}</p>
                    )}
                    {message.media?.type === 'sticker' ? (
                      <StickerView
                        sticker={message.media}
                        telegram={connectionRef.current?.client ?? null}
                      />
                    ) : (
                      <p class="whitespace-pre-wrap break-words text-[15px] leading-5">
                        {message.text ? <MessageText message={message} /> : 'Unsupported message'}
                      </p>
                    )}
                    <time class="mt-1 block text-right text-[10px] text-zinc-400/80">
                      {timeLabel(message.date)}
                    </time>
                  </article>
                ))}
                <div ref={messageEndRef} />
              </div>
            </div>

            <form class="relative shrink-0 border-t border-zinc-800 bg-zinc-900 p-3 md:px-6" onSubmit={sendMessage}>
              {stickerPickerOpen && (
                <section class="absolute bottom-full left-3 right-3 z-20 mx-auto mb-2 flex max-h-[70vh] max-w-3xl flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black/50">
                  <div class="flex gap-2 border-b border-zinc-800 p-3">
                    <input
                      class="min-w-0 flex-1 rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none placeholder:text-zinc-600 focus:border-sky-500"
                      value={stickerSearch}
                      onInput={(event) => setStickerSearch(event.currentTarget.value)}
                      placeholder="Search installed stickers"
                      aria-label="Search installed stickers"
                    />
                    <button
                      class={`shrink-0 rounded-xl border px-3 text-xs font-semibold transition ${largeStickerPreviews ? 'border-sky-500 bg-sky-500/20 text-sky-200' : 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`}
                      type="button"
                      title="Show sticker previews two times larger"
                      aria-label="Show sticker previews two times larger"
                      aria-pressed={largeStickerPreviews}
                      onClick={() => setLargeStickerPreviews((current) => !current)}
                    >
                     Big
                    </button>
                  </div>
                  <nav class="flex shrink-0 gap-1 overflow-x-auto border-b border-zinc-800 p-2" aria-label="Sticker packs">
                    {[
                      { id: 'recent', label: 'Recent' },
                      { id: 'favorites', label: 'Favorites' },
                      ...stickerPacks.map((pack) => ({ id: pack.shortName, label: pack.title })),
                    ].map((tab) => (
                      <button
                        key={tab.id}
                        class={`shrink-0 rounded-lg px-3 py-1.5 text-xs ${stickerTab === tab.id && !stickerSearch ? 'bg-sky-500/20 text-sky-200' : 'text-zinc-400 hover:bg-zinc-800'}`}
                        type="button"
                        title={tab.label}
                        onClick={() => {
                          setStickerSearch('')
                          setStickerTab(tab.id)
                        }}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </nav>
                  <div class="min-h-48 flex-1 overflow-y-auto p-3">
                    {stickerPickerLoading ? (
                      <p class="grid min-h-40 place-items-center text-sm text-zinc-500">Loading stickers…</p>
                    ) : pickerStickers.length ? (
                      <div
                        class="grid gap-2"
                        style={{
                          gridTemplateColumns: `repeat(auto-fill, minmax(${largeStickerPreviews ? '12rem' : '4rem'}, 1fr))`,
                        }}
                      >
                        {pickerStickers.map((sticker) => {
                          const disabled = sticker.sourceType !== 'static'
                          return (
                            <button
                              key={sticker.uniqueFileId}
                              class="relative grid aspect-square place-items-center rounded-xl hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
                              type="button"
                              disabled={disabled || busy}
                              title={disabled ? `${sticker.sourceType === 'video' ? 'Video' : 'Animated'} stickers are not supported for sending yet` : `Send ${sticker.emoji || 'sticker'}`}
                              onClick={() => void sendSticker(sticker)}
                            >
                              {disabled ? (
                                <>
                                  <span class={largeStickerPreviews ? 'text-4xl' : 'text-2xl'}>{sticker.emoji || '◌'}</span>
                                  <span class="absolute bottom-1 rounded bg-zinc-950/80 px-1 text-[9px] uppercase text-zinc-400">
                                    {sticker.sourceType}
                                  </span>
                                </>
                              ) : (
                                <StickerView
                                  sticker={sticker}
                                  telegram={connectionRef.current?.client ?? null}
                                  compact
                                  largePreview={largeStickerPreviews}
                                />
                              )}
                            </button>
                          )
                        })}
                      </div>
                    ) : (
                      <p class="grid min-h-40 place-items-center text-sm text-zinc-500">No stickers found.</p>
                    )}
                  </div>
                </section>
              )}
              <div class="mx-auto flex max-w-3xl items-end gap-2">
                <button
                  class={`grid size-11 shrink-0 place-items-center rounded-full border text-lg transition ${stickerPickerOpen ? 'border-sky-500 bg-sky-500/15' : 'border-zinc-700 bg-zinc-800 hover:bg-zinc-700'}`}
                  type="button"
                  onClick={toggleStickerPicker}
                  aria-label="Open sticker picker"
                  aria-expanded={stickerPickerOpen}
                >
                  ◇
                </button>
                <textarea
                  class="max-h-36 min-h-11 flex-1 resize-none rounded-2xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm outline-none placeholder:text-zinc-500 focus:border-sky-500"
                  rows={1}
                  value={draft}
                  onInput={(event) => setDraft(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      event.currentTarget.form?.requestSubmit()
                    }
                  }}
                  placeholder="Message"
                />
                <button
                  class="grid size-11 shrink-0 place-items-center rounded-full bg-sky-500 font-bold text-white transition hover:bg-sky-400 disabled:opacity-40"
                  disabled={!draft.trim() || busy}
                  type="submit"
                  aria-label="Send message"
                >
                  ↑
                </button>
              </div>
            </form>
          </>
        ) : (
          <div class="m-auto text-center text-zinc-600">
            <div class="mx-auto mb-3 grid size-14 place-items-center rounded-2xl border border-zinc-800 text-xl">T</div>
            <p class="text-sm">Select a private chat</p>
          </div>
        )}
      </section>

      {error && screen === 'chats' && (
        <button
          class="fixed bottom-20 left-1/2 z-20 -translate-x-1/2 rounded-xl border border-red-900/60 bg-red-950 px-4 py-3 text-sm text-red-200 shadow-xl"
          onClick={() => setError('')}
        >
          {error}
        </button>
      )}
    </main>
  )
}
