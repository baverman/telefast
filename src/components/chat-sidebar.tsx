import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useTelegram, dialogId, isGroupPeer } from '../telegram/telegram-provider'
import { useDialogs } from '../telegram/queries'
import { Avatar, messagePreview, timeLabel } from './media'
import { getTheme, setTheme, type Theme } from '../theme'

export function ChatSidebar({ selectedPeerId }: { selectedPeerId?: string }) {
  const { client, busy, logout, notificationPermission, notificationsEnabled, setNotificationsEnabled, markRead } = useTelegram()
  const dialogsQuery = useDialogs()
  const dialogs = dialogsQuery.data ?? []
  const [search, setSearch] = useState('')
  const [theme, setSelectedTheme] = useState<Theme>(getTheme)
  const menuRef = useRef<HTMLDetailsElement>(null)
  const closeMenu = () => {
    if (menuRef.current) menuRef.current.open = false
  }
  useEffect(() => {
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) closeMenu()
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu()
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [])
  const visibleDialogs = useMemo(() => {
    const query = search.trim().toLowerCase()
    return query ? dialogs.filter((dialog) => dialog.peer.displayName.toLowerCase().includes(query)) : dialogs
  }, [dialogs, search])

  return (
    <aside class={`${selectedPeerId ? 'hidden md:flex' : 'flex'} w-full shrink-0 flex-col border-r border-base-300 bg-base-100 md:w-88`}>
      <header class="flex h-16 items-center gap-2 border-b border-base-300 px-4">
        <details ref={menuRef} class="relative">
          <summary class="icon-button list-none text-lg [&::-webkit-details-marker]:hidden" aria-label="Open app menu" title="App menu">☰</summary>
          <div class="absolute left-0 top-full z-30 mt-2 grid w-56 gap-2 rounded-xl border border-base-300 bg-base-100 p-2 shadow-xl shadow-black/20">
            <label class="flex items-center justify-between gap-3 px-2 py-1 text-sm">
              <span>Theme</span>
              <select
                class="rounded-lg border border-base-300 bg-base-100 px-2 py-1 text-sm text-base-content outline-none focus:border-primary"
                value={theme}
                onChange={(event) => {
                  const nextTheme = event.currentTarget.value as Theme
                  setSelectedTheme(nextTheme)
                  setTheme(nextTheme)
                  closeMenu()
                }}
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            {notificationPermission !== 'unsupported' && (
              <button
                class="rounded-lg px-2 py-2 text-left text-sm disabled:opacity-40"
                disabled={notificationPermission === 'denied'}
                onClick={() => {
                  closeMenu()
                  void setNotificationsEnabled(!notificationsEnabled)
                }}
                title={notificationPermission === 'denied' ? 'Notifications are blocked in browser settings' : undefined}
              >
                {notificationPermission === 'denied' ? 'Notifications blocked' : notificationsEnabled ? 'Notifications on' : 'Notifications off'}
              </button>
            )}
            <button class="rounded-lg px-2 py-2 text-left text-sm text-error disabled:opacity-40" disabled={busy} onClick={() => { closeMenu(); void logout() }}>Exit</button>
          </div>
        </details>
        <strong class="mr-auto tracking-tight">Telefast</strong>
      </header>
      <div class="p-3">
        <input
          class="w-full rounded-xl border border-base-300 bg-base-100 px-4 py-2.5 text-sm outline-none themed-input focus:border-primary"
          value={search}
          onInput={(event) => setSearch(event.currentTarget.value)}
          placeholder="Search chats"
        />
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {visibleDialogs.map((dialog) => {
          const id = dialogId(dialog)
          return (
            <a
              key={id}
              href={`/chat/${encodeURIComponent(id)}`}
              class={`flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors ${selectedPeerId === id ? 'bg-primary/15' : ''}`}
            >
              <Avatar
                peer={dialog.peer}
                telegram={client}
                className="grid size-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-sky-500 to-indigo-500 text-sm font-semibold text-primary-content"
              />
              <span class="min-w-0 flex-1">
                <span class="flex items-baseline gap-2">
                  <strong class="min-w-0 flex-1 truncate text-sm font-medium">{dialog.peer.displayName}</strong>
                  <time class="text-[11px] text-muted">{timeLabel(dialog.lastMessage?.date)}</time>
                </span>
                <span class="mt-1 flex items-center gap-2">
                  <span class="min-w-0 flex-1 truncate text-xs text-muted">
                    {messagePreview(dialog.lastMessage, isGroupPeer(dialog.peer))}
                  </span>
                  {dialog.unreadCount > 0 && (
                    <span
                      class={`min-w-5 cursor-pointer rounded-full px-1.5 py-0.5 text-center text-[10px] font-bold ${dialog.isMuted ? 'bg-base-300 text-muted' : 'bg-primary text-primary-content'}`}
                      title={dialog.isMuted ? 'Muted chat' : undefined}
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        void markRead(id)
                      }}
                    >
                      {dialog.unreadCount}
                    </span>
                  )}
                </span>
              </span>
            </a>
          )
        })}
        {dialogsQuery.isPending && <p class="px-4 py-8 text-center text-sm text-muted">Loading chats…</p>}
        {!dialogsQuery.isPending && !visibleDialogs.length && <p class="px-4 py-8 text-center text-sm text-muted">No chats found.</p>}
      </div>
    </aside>
  )
}
