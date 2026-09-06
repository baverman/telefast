import { useEffect, useRef, useState } from 'preact/hooks'
import { useQuery } from '@tanstack/preact-query'
import type { FileLocation, Message, MessageAction } from '@mtcute/web'
import type { TelefastClient } from '../telegram'
import { mediaUrl } from '../telegram/media-cache'
import { useTelegram } from '../telegram/telegram-provider'
import { MessageText, useVisible } from './media'

function useMediaUrl(
  telegram: TelefastClient | null,
  key: string,
  source: FileLocation | undefined,
  mimeType: string,
  visible: boolean,
  fileName?: string | null,
) {
  const { blobCache } = useTelegram()
  return useQuery({
    queryKey: ['telegram', 'media-url', key],
    queryFn: () => mediaUrl(blobCache!, telegram!, key, source!, mimeType, fileName),
    enabled: Boolean(blobCache && telegram && source && visible),
    staleTime: 'static',
    gcTime: 10 * 60_000,
  })
}

function formatBytes(bytes: number | undefined) {
  if (!bytes || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function MediaDownloadLink({ url, fileName }: { url: string; fileName: string }) {
  return (
    <a
      href={url}
      download={fileName}
      class="inline-flex rounded-full bg-base-100 px-3 py-1.5 text-xs text-base-content"
    >
      ↓ Download
    </a>
  )
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
  const source = photo.getThumbnail('x') ?? photo.getThumbnail('m') ?? photo.getThumbnail('s') ?? photo
  const media = useMediaUrl(
    telegram,
    `photo-${source.uniqueFileId}`,
    source,
    'image/jpeg',
    visible,
  )
  const url = media.data ?? ''

  return (
    <div
      ref={hostRef}
      class="max-w-full overflow-hidden rounded-lg bg-base-100"
      style={{ width: `min(${photo.width}px, 20rem)`, aspectRatio: `${photo.width} / ${photo.height}` }}
    >
      <a href={url} target="_blank" rel="noopener noreferrer" class="block size-full">
        {visible && <img class="size-full object-contain" src={url} alt="Photo" decoding="async" />}
      </a>
    </div>
  )
}

function VideoView({ message, telegram }: { message: Message; telegram: TelefastClient | null }) {
  const video = message.media as Extract<NonNullable<Message['media']>, { type: 'video' }>
  const hostRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [hovered, setHovered] = useState(false)
  const visible = useVisible(hostRef, '240px')
  const posterThumb = video.getThumbnail('m') ?? video.getThumbnail('s')
  const poster = useMediaUrl(
    telegram,
    `poster-${video.uniqueFileId}`,
    posterThumb ?? undefined,
    'image/jpeg',
    visible,
  )
  const media = useMediaUrl(
    telegram,
    `video-${video.uniqueFileId}`,
    video,
    video.mimeType || 'video/mp4',
    visible,
    video.fileName,
  )
  const posterUrl = poster.data
  const url = media.data ?? ''
  const fileName = video.fileName || (video.isAnimation ? 'animation.mp4' : 'video.mp4')

  useEffect(() => {
    if (!video.isAnimation || !videoRef.current) return
    if (hovered) void videoRef.current.play().catch(() => {})
    else videoRef.current.pause()
  }, [hovered, url, video.isAnimation])

  return (
    <div
      ref={hostRef}
      class="max-w-full"
      style={{ width: `min(${video.width}px, 20rem)` }}
    >
      <div
        class="relative"
        onMouseEnter={() => { if (video.isAnimation) setHovered(true) }}
        onMouseLeave={() => { if (video.isAnimation) setHovered(false) }}
      >
        <video
          ref={videoRef}
          class="block w-full rounded-lg bg-base-100 object-contain"
          style={{ aspectRatio: `${video.width} / ${video.height}` }}
          src={visible ? url : undefined}
          poster={posterUrl}
          controls={!video.isAnimation}
          loop={video.isAnimation}
          muted={video.isAnimation}
          playsInline
          preload="metadata"
        />
        {video.isAnimation && !hovered && (
          <span class="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden="true">
            <span class="grid size-10 place-items-center rounded-full bg-black/55 pl-0.5 text-sm text-white shadow-lg">▶</span>
          </span>
        )}
      </div>
      <div class="mt-2"><MediaDownloadLink url={url} fileName={fileName} /></div>
    </div>
  )
}

function isImageDocument(document: Extract<NonNullable<Message['media']>, { type: 'document' }>) {
  if (document.mimeType.startsWith('image/')) return true
  return /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(document.fileName ?? '')
}

function isVideoDocument(document: Extract<NonNullable<Message['media']>, { type: 'document' }>) {
  if (document.mimeType.startsWith('video/')) return true
  return /\.(mp4|m4v|mov|webm|mkv|avi)$/i.test(document.fileName ?? '')
}

function DocumentView({ message, telegram }: { message: Message; telegram: TelefastClient | null }) {
  const document = message.media as Extract<NonNullable<Message['media']>, { type: 'document' }>
  const hostRef = useRef<HTMLDivElement | null>(null)
  const visible = useVisible(hostRef, '240px')
  const image = isImageDocument(document)
  const video = isVideoDocument(document)
  const thumbnail = image || video
    ? document.getThumbnail('m') ?? document.getThumbnail('s') ?? document.thumbnails[0]
    : undefined
  const media = useMediaUrl(
    telegram,
    `document-${document.uniqueFileId}`,
    document,
    document.mimeType || 'application/octet-stream',
    visible,
    document.fileName,
  )
  const poster = useMediaUrl(
    telegram,
    `document-poster-${thumbnail?.uniqueFileId ?? ''}`,
    thumbnail,
    'image/jpeg',
    visible && video,
  )
  const posterUrl = poster.data
  const url = media.data ?? ''

  if (video) {
    const width = thumbnail?.width ?? 320
    const height = thumbnail?.height ?? 180
    const fileName = document.fileName || 'video.mp4'
    return (
      <div
        ref={hostRef}
        class="max-w-full"
        style={{ width: `min(${width}px, 20rem)` }}
      >
        <video
          class="block w-full rounded-lg bg-base-100 object-contain"
          style={{ aspectRatio: `${width} / ${height}` }}
          src={visible ? url : undefined}
          poster={posterUrl}
          controls
          playsInline
          preload="metadata"
        />
        <div class="mt-2"><MediaDownloadLink url={url} fileName={fileName} /></div>
      </div>
    )
  }

  if (image) {
    const width = thumbnail?.width ?? 0
    const height = thumbnail?.height ?? 0
    const style = width && height
      ? { width: `min(${width}px, 20rem)`, aspectRatio: `${width} / ${height}` }
      : { width: '20rem', aspectRatio: '1 / 1' }

    return (
      <div ref={hostRef} class="max-w-full overflow-hidden rounded-lg bg-base-100" style={style}>
        <a href={url} target="_blank" rel="noopener noreferrer" class="block size-full">
          {visible && <img class="size-full object-contain" src={url} alt={document.fileName || 'Image'} decoding="async" />}
        </a>
      </div>
    )
  }

  return (
    <a
      href={url}
      download={document.fileName ?? undefined}
      class="flex max-w-full items-center gap-3 rounded-lg border border-base-300 bg-base-200/40 p-3"
    >
      <span class="grid size-10 shrink-0 place-items-center rounded-lg bg-base-300 text-lg">📄</span>
      <span class="min-w-0">
        <strong class="block truncate text-sm">{document.fileName || 'Document'}</strong>
        <span class="text-xs text-muted">{formatBytes(document.fileSize) || document.mimeType}</span>
      </span>
    </a>
  )
}

function AudioView({ message, telegram }: { message: Message; telegram: TelefastClient | null }) {
  const audio = message.media as Extract<NonNullable<Message['media']>, { type: 'audio' }>
  const media = useMediaUrl(
    telegram,
    `audio-${audio.uniqueFileId}`,
    audio,
    audio.mimeType || 'audio/mpeg',
    true,
    audio.fileName,
  )
  const url = media.data ?? ''

  return (
    <div class="max-w-full">
      <p class="mb-1 truncate text-sm font-medium">{audio.title || audio.performer || 'Audio'}</p>
      <audio class="max-w-full" src={url} controls preload="none" />
      <MediaDownloadLink url={url} fileName={audio.fileName || 'audio.mp3'} />
    </div>
  )
}

function VoiceView({ message, telegram }: { message: Message; telegram: TelefastClient | null }) {
  const voice = message.media as Extract<NonNullable<Message['media']>, { type: 'voice' }>
  const media = useMediaUrl(
    telegram,
    `voice-${voice.uniqueFileId}`,
    voice,
    voice.mimeType || 'audio/ogg',
    true,
    voice.fileName,
  )
  const url = media.data ?? ''

  return (
    <div class="max-w-full">
      <audio class="max-w-full" src={url} controls preload="none" />
      <MediaDownloadLink url={url} fileName={voice.fileName || 'voice.ogg'} />
    </div>
  )
}

function ContactView({ message }: { message: Message }) {
  const contact = message.media as Extract<NonNullable<Message['media']>, { type: 'contact' }>
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ')
  return (
    <a href={`tel:${contact.phoneNumber}`} class="flex max-w-full items-center gap-3">
      <span class="grid size-10 shrink-0 place-items-center rounded-full bg-primary/15 text-lg">👤</span>
      <span class="min-w-0">
        <strong class="block truncate text-sm">{name || 'Contact'}</strong>
        <span class="text-xs text-muted">{contact.phoneNumber}</span>
      </span>
    </a>
  )
}

function MediaBlock({ message, telegram }: { message: Message; telegram: TelefastClient | null }) {
  switch (message.media?.type) {
    case 'photo': return <PhotoView message={message} telegram={telegram} />
    case 'video': return <VideoView message={message} telegram={telegram} />
    case 'document': return <DocumentView message={message} telegram={telegram} />
    case 'audio': return <AudioView message={message} telegram={telegram} />
    case 'voice': return <VoiceView message={message} telegram={telegram} />
    case 'contact': return <ContactView message={message} />
    default: return null
  }
}

export function MessageContent({ message, telegram }: { message: Message; telegram: TelefastClient | null }) {
  if (message.isService) {
    return <span class="text-sm text-muted">{serviceMessageText(message.action, message.sender.displayName)}</span>
  }

  return (
    <div class="flex max-w-full flex-col gap-2">
      <MediaBlock message={message} telegram={telegram} />
      {message.text && (
        <p data-message-text class="whitespace-pre-wrap break-words text-[15px] leading-5">
          <MessageText message={message} />
        </p>
      )}
    </div>
  )
}
