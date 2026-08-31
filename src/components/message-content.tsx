import { useRef } from 'preact/hooks'
import { useQuery } from '@tanstack/preact-query'
import type { FileLocation, Message, MessageAction } from '@mtcute/web'
import type { TelefastClient } from '../telegram'
import { cachedMediaUrl } from '../telegram/media-cache'
import { MessageText, useVisible } from './media'

function useMediaUrl(
  telegram: TelefastClient | null,
  key: string,
  source: FileLocation | undefined,
  mimeType: string,
  visible: boolean,
) {
  return useQuery({
    queryKey: ['telegram', 'media-url', key],
    queryFn: () => cachedMediaUrl(telegram!, key, source!, mimeType),
    enabled: Boolean(telegram && source && visible),
    staleTime: Infinity,
  })
}

function formatBytes(bytes: number | undefined) {
  if (!bytes || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function serviceMessageText(action: MessageAction | null, sender: string) {
  switch (action?.type) {
    case 'chat_created': return `${sender} created the group`
    case 'channel_created': return 'Channel created'
    case 'title_changed': return `${sender} renamed the group to "${action.title}"`
    case 'photo_changed': return `${sender} updated the group photo`
    case 'photo_deleted': return `${sender} removed the group photo`
    case 'users_added': return `${sender} added members`
    case 'user_left': return `${sender} left the group`
    case 'user_removed': return `${sender} removed a member`
    case 'user_joined_link':
    case 'user_joined_approved': return `${sender} joined the group`
    case 'contact_joined': return `${sender} joined Telegram`
    case 'message_pinned': return `${sender} pinned a message`
    case 'chat_migrate_to': return 'Group migrated to a supergroup'
    case 'channel_migrate_from': return 'Supergroup migrated from a group'
    case 'history_cleared': return 'History cleared'
    case 'call': return `${sender} made a ${action.isVideo ? 'video' : 'voice'} call`
    case 'custom': return action.action
    default: return 'Service message'
  }
}

function PhotoView({ message, telegram }: { message: Message; telegram: TelefastClient | null }) {
  const photo = message.media as Extract<NonNullable<Message['media']>, { type: 'photo' }>
  const hostRef = useRef<HTMLDivElement | null>(null)
  const visible = useVisible(hostRef, '240px')
  const preview = photo.getThumbnail('x') ?? photo.getThumbnail('m') ?? photo.getThumbnail('s') ?? photo
  const url = useMediaUrl(
    telegram,
    `photo-${preview.uniqueFileId}`,
    preview,
    'image/jpeg',
    visible,
  )

  return (
    <div
      ref={hostRef}
      class="max-w-full overflow-hidden rounded-lg"
      style={{ width: `min(${photo.width}px, 20rem)`, aspectRatio: `${photo.width} / ${photo.height}` }}
    >
      <a href={url.data} target="_blank" rel="noopener noreferrer" class="block size-full">
        <img class="size-full object-contain" src={url.data} alt="Photo" decoding="async" />
      </a>
    </div>
  )
}

function VideoView({ message, telegram, gif }: { message: Message; telegram: TelefastClient | null; gif: boolean }) {
  const video = message.media as Extract<NonNullable<Message['media']>, { type: 'video' }>
  const hostRef = useRef<HTMLDivElement | null>(null)
  const visible = useVisible(hostRef, '240px')
  const posterThumb = video.getThumbnail('m') ?? video.getThumbnail('s')
  const poster = useMediaUrl(
    telegram,
    `poster-${video.uniqueFileId}`,
    posterThumb ?? undefined,
    'image/jpeg',
    visible,
  )
  const url = useMediaUrl(
    telegram,
    `video-${video.uniqueFileId}`,
    video,
    video.mimeType || 'video/mp4',
    visible,
  )

  return (
    <div
      ref={hostRef}
      class="max-w-full overflow-hidden rounded-lg"
      style={{ width: `min(${video.width}px, 20rem)`, aspectRatio: `${video.width} / ${video.height}` }}
    >
      <video
        class="size-full object-contain"
        src={url.data}
        poster={poster.data}
        controls={!gif}
        autoPlay={gif}
        loop={gif}
        muted={gif}
        playsInline
        preload="metadata"
      />
    </div>
  )
}

function isImageDocument(document: Extract<NonNullable<Message['media']>, { type: 'document' }>) {
  if (document.mimeType.startsWith('image/')) return true
  return /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(document.fileName ?? '')
}

function DocumentView({ message, telegram }: { message: Message; telegram: TelefastClient | null }) {
  const document = message.media as Extract<NonNullable<Message['media']>, { type: 'document' }>
  const hostRef = useRef<HTMLDivElement | null>(null)
  const visible = useVisible(hostRef, '240px')
  const url = useMediaUrl(
    telegram,
    `document-${document.uniqueFileId}`,
    document,
    document.mimeType || 'application/octet-stream',
    visible,
  )
  const image = isImageDocument(document)

  if (image) {
    const width = document.thumbnails[0]?.width ?? 0
    const height = document.thumbnails[0]?.height ?? 0
    const style = width && height
      ? { width: `min(${width}px, 20rem)`, aspectRatio: `${width} / ${height}` }
      : { width: '20rem', aspectRatio: '1 / 1' }

    return (
      <div ref={hostRef} class="max-w-full overflow-hidden rounded-lg" style={style}>
        <a href={url.data} target="_blank" rel="noopener noreferrer" class="block size-full">
          <img class="size-full object-contain" src={url.data} alt={document.fileName || 'Image'} decoding="async" />
        </a>
      </div>
    )
  }

  return (
    <div ref={hostRef}>
      <a
        href={url.data ?? undefined}
        download={document.fileName ?? undefined}
        class={`flex max-w-full items-center gap-3 rounded-lg border border-zinc-700 bg-zinc-950/40 p-3 ${url.data ? 'cursor-pointer hover:bg-zinc-800/60' : 'pointer-events-none'}`}
      >
        <span class="grid size-10 shrink-0 place-items-center rounded-lg bg-zinc-800 text-lg">📄</span>
        <span class="min-w-0">
          <strong class="block truncate text-sm">{document.fileName || 'Document'}</strong>
          <span class="text-xs text-zinc-500">{formatBytes(document.fileSize) || document.mimeType}</span>
        </span>
      </a>
    </div>
  )
}

function AudioView({ message, telegram }: { message: Message; telegram: TelefastClient | null }) {
  const audio = message.media as Extract<NonNullable<Message['media']>, { type: 'audio' }>
  const hostRef = useRef<HTMLDivElement | null>(null)
  const visible = useVisible(hostRef, '240px')
  const url = useMediaUrl(telegram, `audio-${audio.uniqueFileId}`, audio, audio.mimeType || 'audio/mpeg', visible)

  return (
    <div ref={hostRef} class="max-w-full">
      <p class="mb-1 truncate text-sm font-medium">{audio.title || audio.performer || 'Audio'}</p>
      {url.data
        ? <audio class="max-w-full" src={url.data} controls preload="none" />
        : <span class="text-xs text-zinc-500">Audio</span>}
    </div>
  )
}

function VoiceView({ message, telegram }: { message: Message; telegram: TelefastClient | null }) {
  const voice = message.media as Extract<NonNullable<Message['media']>, { type: 'voice' }>
  const hostRef = useRef<HTMLDivElement | null>(null)
  const visible = useVisible(hostRef, '240px')
  const url = useMediaUrl(telegram, `voice-${voice.uniqueFileId}`, voice, voice.mimeType || 'audio/ogg', visible)

  return (
    <div ref={hostRef} class="max-w-full">
      {url.data
        ? <audio class="max-w-full" src={url.data} controls preload="none" />
        : <span class="text-xs text-zinc-500">Voice message · {Math.round(voice.duration)}s</span>}
    </div>
  )
}

function ContactView({ message }: { message: Message }) {
  const contact = message.media as Extract<NonNullable<Message['media']>, { type: 'contact' }>
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ')
  return (
    <a href={`tel:${contact.phoneNumber}`} class="flex max-w-full items-center gap-3">
      <span class="grid size-10 shrink-0 place-items-center rounded-full bg-sky-500/20 text-lg">👤</span>
      <span class="min-w-0">
        <strong class="block truncate text-sm">{name || 'Contact'}</strong>
        <span class="text-xs text-zinc-500">{contact.phoneNumber}</span>
      </span>
    </a>
  )
}

function MediaBlock({ message, telegram }: { message: Message; telegram: TelefastClient | null }) {
  switch (message.media?.type) {
    case 'photo': return <PhotoView message={message} telegram={telegram} />
    case 'video': return <VideoView message={message} telegram={telegram} gif={message.media.isAnimation} />
    case 'document': return <DocumentView message={message} telegram={telegram} />
    case 'audio': return <AudioView message={message} telegram={telegram} />
    case 'voice': return <VoiceView message={message} telegram={telegram} />
    case 'contact': return <ContactView message={message} />
    default: return null
  }
}

export function MessageContent({ message, telegram }: { message: Message; telegram: TelefastClient | null }) {
  if (message.isService) {
    return <span class="text-sm text-zinc-400">{serviceMessageText(message.action, message.sender.displayName)}</span>
  }

  return (
    <div class="flex max-w-full flex-col gap-2">
      <MediaBlock message={message} telegram={telegram} />
      {message.text && (
        <p class="whitespace-pre-wrap break-words text-[15px] leading-5">
          <MessageText message={message} />
        </p>
      )}
    </div>
  )
}
