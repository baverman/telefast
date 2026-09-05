import type { ComponentChildren, RefObject } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { useQuery } from '@tanstack/preact-query'
import type { Dialog, Message } from '@mtcute/web'
import type { TelefastClient } from '../telegram'
import { cachedMediaUrl } from '../telegram/media-cache'
import { useTelegram } from '../telegram/telegram-provider'

export function initials(name = '?') {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
}

export function timeLabel(date?: Date | null) {
  if (!date) return ''
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(date)
}

export function messageText(message?: Message | null) {
  if (!message) return ''
  if (message.text) return message.text
  if (message.media?.type === 'sticker') {
    return `${message.media.emoji ? `${message.media.emoji} ` : ''}Sticker`
  }
  return message.media ? 'Attachment' : ''
}

export function messagePreview(message?: Message | null, includeSender = false) {
  const text = messageText(message)
  if (!message || !text || !includeSender || message.isOutgoing) return text
  return `${message.sender.displayName}: ${text}`
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

export function MessageText({ message }: { message: Message }) {
  const parts: ComponentChildren[] = []
  let cursor = 0
  const entities = [...message.entities].sort((left, right) => left.offset - right.offset)

  entities.forEach((entity) => {
    if (entity.offset < cursor) return
    const text = message.text.slice(entity.offset, entity.offset + entity.length)

    if (entity.is('bot_command')) {
      if (entity.offset > cursor) parts.push(message.text.slice(cursor, entity.offset))
      parts.push(
        <span
          key={`command-${entity.offset}-${entity.length}`}
          class="rounded bg-sky-500/10 px-1 font-mono text-sky-300"
        >
          {text}
        </span>,
      )
      cursor = entity.offset + entity.length
      return
    }

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

export function useVisible(ref: RefObject<Element>, rootMargin: string) {
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    if (visible) return
    const host = ref.current
    if (!host || typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      setVisible(true)
      observer.disconnect()
    }, { rootMargin })
    observer.observe(host)
    return () => observer.disconnect()
  }, [ref, rootMargin, visible])
  return visible
}

export function Avatar({
  peer,
  telegram,
  className,
}: {
  peer: Dialog['peer']
  telegram: TelefastClient | null
  className: string
}) {
  const { blobCache } = useTelegram()
  const hostRef = useRef<HTMLSpanElement | null>(null)
  const visible = useVisible(hostRef, '160px')
  const photo = peer.photo?.small
  const photoKey = photo?.uniqueFileId ?? ''
  const avatar = useQuery({
    queryKey: ['telegram', 'media-url', `avatar-${photoKey}`],
    queryFn: () => cachedMediaUrl(blobCache!, telegram!, `avatar-${photoKey}`, photo!, 'image/jpeg'),
    enabled: Boolean(blobCache && telegram && photo && visible),
    staleTime: 'static',
    gcTime: 10 * 60_000,
  })
  const source = avatar.data ?? ''

  return (
    <span ref={hostRef} class={`${className} overflow-hidden`} aria-hidden="true">
      {source ? <img class="size-full object-cover" src={source} alt="" decoding="async" /> : initials(peer.displayName)}
    </span>
  )
}

type StickerMedia = Extract<NonNullable<Message['media']>, { type: 'sticker' }>

export function StickerView({
         sticker,
         telegram,
         compact = false,
         animate = true,
       }: {
         sticker: StickerMedia
         telegram: TelefastClient | null
         compact?: boolean
         animate?: boolean
       }) {
         const { blobCache } = useTelegram()
         const hostRef = useRef<HTMLDivElement | null>(null)
         const animationHostRef = useRef<HTMLDivElement | null>(null)
         const videoRef = useRef<HTMLVideoElement | null>(null)
         const lottieRef = useRef<{ play: () => void; pause: () => void; destroy: () => void } | null>(null)
         const shouldPlayRef = useRef(false)
         const [hovered, setHovered] = useState(false)
         const visible = useVisible(hostRef, '240px')
         const animated = sticker.sourceType === 'animated'
         const playable = animated || sticker.sourceType === 'video'
         const aspectRatio = sticker.width > 0 && sticker.height > 0 ? sticker.width / sticker.height : 1
         const shouldPlay = compact ? animate : hovered
         shouldPlayRef.current = shouldPlay
         const previewing = compact && !animate && playable
         const thumbnail = sticker.thumbnails[sticker.thumbnails.length - 1]
         const mimeType = sticker.sourceType === 'video' ? 'video/webm' : 'image/webp'
         const mediaKey = previewing ? `${sticker.uniqueFileId}:preview` : sticker.uniqueFileId
         const stickerQuery = useQuery({
           queryKey: animated && !previewing
             ? ['telegram', 'sticker-file', mediaKey]
             : ['telegram', 'media-url', mediaKey],
           queryFn: async (): Promise<string | Uint8Array | null> => {
             if (!telegram) return null
             if (previewing) {
               if (!thumbnail) return null
               return cachedMediaUrl(blobCache!, telegram, mediaKey, thumbnail, 'image/jpeg')
             }
             if (animated) return telegram.downloadAsBuffer(sticker)
             return cachedMediaUrl(blobCache!, telegram, mediaKey, sticker, mimeType)
           },
           enabled: Boolean(blobCache && telegram && visible),
           staleTime: 'static',
           gcTime: 10 * 60_000,
         })
         const source = typeof stickerQuery.data === 'string' ? stickerQuery.data : ''
         const bytes = stickerQuery.data instanceof Uint8Array ? stickerQuery.data : undefined

         useEffect(() => {
           const animationHost = animationHostRef.current
           if (!bytes || !animated || !animationHost) return
           let active = true
           void (async () => {
             const animationData = await new Response(
               new Blob([Uint8Array.from(bytes)]).stream().pipeThrough(new DecompressionStream('gzip')),
             ).json()
             const { default: lottie } = await import('lottie-web/build/player/lottie_light')
             if (!active) return
             const animation = lottie.loadAnimation({
               container: animationHost,
               renderer: 'svg',
               loop: true,
               autoplay: false,
               animationData,
             })
             lottieRef.current = animation
             if (shouldPlayRef.current) animation.play()
           })().catch((error) => console.warn('[Telefast] Failed to render sticker', error))
           return () => {
             active = false
             lottieRef.current?.destroy()
             lottieRef.current = null
           }
         }, [animated, bytes])

         useEffect(() => {
           if (shouldPlay) lottieRef.current?.play()
           else lottieRef.current?.pause()

           const video = videoRef.current
           if (!video) return
           if (shouldPlay) void video.play().catch(() => {})
           else video.pause()
         }, [shouldPlay, source])

         const label = `${sticker.emoji ? `${sticker.emoji} ` : ''}Sticker`
         return (
           <div
             ref={hostRef}
             class={compact
               ? 'relative grid w-full place-items-center overflow-hidden'
               : 'relative grid place-items-center'
             }
             style={compact
               ? { aspectRatio: String(aspectRatio) }
               : { aspectRatio: String(aspectRatio), width: `${Math.min(1, aspectRatio) * 15}rem` }
             }
             role="img"
             aria-label={label}
             onMouseEnter={() => { if (!compact) setHovered(true) }}
             onMouseLeave={() => { if (!compact) setHovered(false) }}
           >
             {previewing && source && <img class="size-full object-contain" src={source} alt={label} decoding="async" />}
             {previewing && !source && <span class="text-2xl">{sticker.emoji || '◌'}</span>}
             {!previewing && animated && <div ref={animationHostRef} class="size-full" />}
             {!previewing && sticker.sourceType === 'static' && source && <img class="size-full object-contain" src={source} alt={label} decoding="async" />}
             {!previewing && sticker.sourceType === 'video' && source && <video ref={videoRef} class="size-full object-contain" src={source} loop muted playsInline aria-label={label} />}
             {!compact && playable && !hovered && (
               <span class="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden="true">
                 <span class="grid size-10 place-items-center rounded-full bg-black/55 pl-0.5 text-sm text-white shadow-lg">▶</span>
               </span>
             )}
             {stickerQuery.isError && <span class="text-sm text-zinc-400">{label}</span>}
           </div>
         )
       }
