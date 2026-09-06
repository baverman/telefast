import { useQuery } from '@tanstack/preact-query'
import type { FullChat, FullUser } from '@mtcute/web'
import { useLocation } from 'preact-iso'
import { useTelegram } from '../telegram/telegram-provider'
import { useDialog } from '../telegram/queries'
import { Avatar } from './media'

function userStatus(status: string) {
  switch (status) {
    case 'online': return 'Online'
    case 'offline': return 'Offline'
    case 'recently': return 'Last seen recently'
    case 'within_week': return 'Last seen within a week'
    case 'within_month': return 'Last seen within a month'
    case 'long_time_ago': return 'Last seen a long time ago'
    case 'bot': return 'Bot'
    default: return ''
  }
}

function InfoRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div class="flex items-start justify-between gap-6 border-b border-base-300 py-3 last:border-0">
      <span class="text-sm text-muted">{label}</span>
      <span class="break-all text-right text-sm text-base-content">{value}</span>
    </div>
  )
}

export function PeerInfo({ peerId }: { peerId: string }) {
  const location = useLocation()
  const { client } = useTelegram()
  const selected = useDialog(peerId)
  const peer = selected.data?.peer
  const details = useQuery<FullUser | FullChat>({
    queryKey: ['telegram', 'peer-info', String(peer?.id ?? '')],
    queryFn: async (): Promise<FullUser | FullChat> => {
      if (!peer) throw new Error('Chat not found')
      return peer.type === 'user' ? client!.getFullUser(peer) : client!.getFullChat(peer)
    },
    enabled: Boolean(client && peer),
    staleTime: 5 * 60_000,
    retry: false,
  })

  if (!peer) {
    return (
      <section class="flex min-w-0 flex-1 items-center justify-center bg-chat text-sm text-muted">
        {selected.isError ? 'Chat not found' : 'Loading chat…'}
      </section>
    )
  }

  const backQuery = new URLSearchParams()
  if (location.query.thread) backQuery.set('thread', location.query.thread)
  if (location.query.message) backQuery.set('message', location.query.message)
  const backHref = `/chat/${encodeURIComponent(peerId)}${backQuery.size ? `?${backQuery}` : ''}`
  const full = details.data
  const username = full?.username ?? peer.username
  const bio = full?.bio ?? ''
  const heading = peer.type === 'user' ? 'Profile' : peer.chatType === 'channel' ? 'Channel info' : 'Group info'
  const kind = peer.type === 'user'
    ? peer.isBot ? 'Bot' : 'User'
    : peer.chatType === 'channel' ? 'Channel' : 'Group'

  return (
    <section class="flex min-w-0 flex-1 flex-col bg-chat">
      <header class="flex h-16 shrink-0 items-center gap-3 border-b border-base-300 bg-base-100 px-4 backdrop-blur">
        <a href={backHref} class="icon-button" aria-label="Back to chat">←</a>
        <strong class="text-sm font-medium">{heading}</strong>
      </header>
      <div class="min-h-0 flex-1 overflow-y-auto px-5 py-8">
        <div class="mx-auto max-w-lg">
          <div class="mb-8 flex flex-col items-center text-center">
            <Avatar
              peer={peer}
              telegram={client}
              className="grid size-24 place-items-center rounded-full bg-gradient-to-br from-sky-500 to-indigo-500 text-2xl font-semibold"
            />
            <h1 class="mt-4 text-xl font-semibold">{peer.displayName}</h1>
            {username && (
              <a
                href={`https://t.me/${username}`}
                target="_blank"
                rel="noopener noreferrer"
                class="mt-1 text-sm text-primary hover:underline"
              >
                @{username}
              </a>
            )}
            {bio && <p class="mt-4 max-w-md whitespace-pre-wrap text-sm leading-6 text-base-content">{bio}</p>}
          </div>

          {details.isPending && <p class="text-center text-sm text-muted">Loading information…</p>}
          {details.isError && <p class="text-center text-sm text-error">Failed to load full information.</p>}

          <div class="rounded-2xl border border-base-300 bg-base-100 px-4">
            <InfoRow label="Type" value={kind} />
            <InfoRow label="Telegram ID" value={peer.id} />
            {full?.type === 'user' && <InfoRow label="Status" value={userStatus(full.status)} />}
            {full?.type === 'user' && full.phoneNumber && <InfoRow label="Phone" value={full.phoneNumber} />}
            {full?.type === 'user' && full.commonChatsCount > 0 && <InfoRow label="Groups in common" value={full.commonChatsCount} />}
            {full?.type === 'chat' && full.membersCount > 0 && <InfoRow label="Members" value={full.membersCount} />}
            {full?.type === 'chat' && full.onlineCount > 0 && <InfoRow label="Online" value={full.onlineCount} />}
            {full?.type === 'chat' && full.adminsCount > 0 && <InfoRow label="Administrators" value={full.adminsCount} />}
          </div>
        </div>
      </div>
    </section>
  )
}
