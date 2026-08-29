import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { Dialog, Message, SentCode } from '@mtcute/web'
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
  return message.text || (message.media ? 'Attachment' : '')
}

function isPrivateDialog(dialog: Dialog) {
  return dialog.peer.type === 'user'
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
      if (isPrivateDialog(dialog)) nextDialogs.push(dialog)
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
      if (message.chat.type !== 'user') return

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
              body: messageText(message) || 'New message',
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
        if (resolved && isPrivateDialog(resolved)) {
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
      selectedRef.current = null
      setDialogs([])
      setMessages([])
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
                <span class="grid size-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-sky-500 to-indigo-500 text-sm font-semibold text-white">
                  {initials(title)}
                </span>
                <span class="min-w-0 flex-1">
                  <span class="flex items-baseline gap-2">
                    <strong class="min-w-0 flex-1 truncate text-sm font-medium">{title}</strong>
                    <time class="text-[11px] text-zinc-500">{timeLabel(dialog.lastMessage?.date)}</time>
                  </span>
                  <span class="mt-1 flex items-center gap-2">
                    <span class="min-w-0 flex-1 truncate text-xs text-zinc-500">
                      {messageText(dialog.lastMessage)}
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
            <p class="px-4 py-8 text-center text-sm text-zinc-500">No private chats found.</p>
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
              <span class="grid size-9 place-items-center rounded-full bg-gradient-to-br from-sky-500 to-indigo-500 text-xs font-semibold">
                {initials(selected.peer.displayName)}
              </span>
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
                    class={`message-bubble ${message.isOutgoing ? 'message-out' : 'message-in'}`}
                  >
                    <p class="whitespace-pre-wrap break-words text-[15px] leading-5">
                      {messageText(message) || 'Unsupported message'}
                    </p>
                    <time class="mt-1 block text-right text-[10px] text-zinc-400/80">
                      {timeLabel(message.date)}
                    </time>
                  </article>
                ))}
                <div ref={messageEndRef} />
              </div>
            </div>

            <form class="shrink-0 border-t border-zinc-800 bg-zinc-900 p-3 md:px-6" onSubmit={sendMessage}>
              <div class="mx-auto flex max-w-3xl items-end gap-2">
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
