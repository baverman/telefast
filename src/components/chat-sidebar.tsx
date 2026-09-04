import { useMemo, useState } from 'preact/hooks'
import { useTelegram, dialogId, isGroupPeer } from '../telegram/telegram-provider'
import { useDialogs } from '../telegram/queries'
import { Avatar, messagePreview, timeLabel } from './media'

export function ChatSidebar({ selectedPeerId }: { selectedPeerId?: string }) {
  const { client, busy, logout, notificationPermission, enableNotifications, markRead } = useTelegram()
  const dialogsQuery = useDialogs()
  const dialogs = dialogsQuery.data ?? []
  const [search, setSearch] = useState('')
  const visibleDialogs = useMemo(() => {
    const query = search.trim().toLowerCase()
    return query ? dialogs.filter((dialog) => dialog.peer.displayName.toLowerCase().includes(query)) : dialogs
  }, [dialogs, search])

  return (
    <aside class={`${selectedPeerId ? 'hidden md:flex' : 'flex'} w-full shrink-0 flex-col border-r border-zinc-800 bg-zinc-900 md:w-88`}>
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
        <button class="icon-button px-2 text-xs" disabled={busy} onClick={() => void logout()} title="Log out">Exit</button>
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
          return (
            <a
              key={id}
              href={`/chat/${encodeURIComponent(id)}`}
              class={`flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors ${selectedPeerId === id ? 'bg-sky-500/15' : 'hover:bg-zinc-800/70'}`}
            >
              <Avatar
                peer={dialog.peer}
                telegram={client}
                className="grid size-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-sky-500 to-indigo-500 text-sm font-semibold text-white"
              />
              <span class="min-w-0 flex-1">
                <span class="flex items-baseline gap-2">
                  <strong class="min-w-0 flex-1 truncate text-sm font-medium">{dialog.peer.displayName}</strong>
                  <time class="text-[11px] text-zinc-500">{timeLabel(dialog.lastMessage?.date)}</time>
                </span>
                <span class="mt-1 flex items-center gap-2">
                  <span class="min-w-0 flex-1 truncate text-xs text-zinc-500">
                    {messagePreview(dialog.lastMessage, isGroupPeer(dialog.peer))}
                  </span>
                  {dialog.unreadCount > 0 && (
                    <span
                      class={`min-w-5 rounded-full px-1.5 py-0.5 text-center text-[10px] font-bold ${dialog.isMuted ? 'bg-zinc-800 text-zinc-400' : 'bg-sky-500 text-white'}`}
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
        {dialogsQuery.isPending && <p class="px-4 py-8 text-center text-sm text-zinc-500">Loading chats…</p>}
        {!dialogsQuery.isPending && !visibleDialogs.length && <p class="px-4 py-8 text-center text-sm text-zinc-500">No chats found.</p>}
      </div>
    </aside>
  )
}
