import type { ComponentChildren, RefObject } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { useQuery } from '@tanstack/preact-query'
import type { Dialog, Message } from '@mtcute/web'
import type { TelefastClient } from '../telegram'
import { cachedMediaUrl } from '../telegram/media-cache'

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

export function MessageText({ message, onCommand }: { message: Message; onCommand?: (command: string) => void }) {
  const parts: ComponentChildren[] = []
  let cursor = 0
  const entities = [...message.entities].sort((left, right) => left.offset - right.offset)

  entities.forEach((entity) => {
    if (entity.offset < cursor) return
    const text = message.text.slice(entity.offset, entity.offset + entity.length)

    if (entity.is('bot_command')) {
      if (entity.offset > cursor) parts.push(message.text.slice(cursor, entity.offset))
      parts.push(
        <button
          key={`command-${entity.offset}-${entity.length}`}
          type="button"
          class="rounded bg-sky-500/10 px-1 font-mono text-sky-300 hover:bg-sky-500/20"
          onClick={() => onCommand?.(text)}
        >
          {text}
        </button>,
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
  const hostRef = useRef<HTMLSpanElement | null>(null)
  const visible = useVisible(hostRef, '160px')
  const photo = peer.photo?.small
  const photoKey = photo?.uniqueFileId ?? ''
  const avatar = useQuery({
    queryKey: ['telegram', 'avatar', photoKey],
    queryFn: () => telegram!.downloadAsBuffer(photo!),
    enabled: Boolean(telegram && photo && visible),
    staleTime: Infinity,
  })
  const [source, setSource] = useState('')

  useEffect(() => {
    if (!avatar.data) {
      setSource('')
      return
    }
    const url = URL.createObjectURL(new Blob([Uint8Array.from(avatar.data)], { type: 'image/jpeg' }))
    setSource(url)
    return () => URL.revokeObjectURL(url)
  }, [avatar.data])

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
  largePreview = false,
}: {
  sticker: StickerMedia
  telegram: TelefastClient | null
  compact?: boolean
  largePreview?: boolean
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const visible = useVisible(hostRef, '240px')
  const animated = sticker.sourceType === 'animated'
  const mimeType = sticker.sourceType === 'video' ? 'video/webm' : 'image/webp'
  const stickerQuery = useQuery({
    queryKey: ['telegram', 'sticker-file', sticker.uniqueFileId],
    queryFn: async (): Promise<string | Uint8Array | null> => {
      if (!telegram) return null
      if (animated) return telegram.downloadAsBuffer(sticker)
      return cachedMediaUrl(telegram, sticker.uniqueFileId, sticker, mimeType)
    },
    enabled: Boolean(telegram && visible),
    staleTime: Infinity,
  })
  const source = typeof stickerQuery.data === 'string' ? stickerQuery.data : ''
  const bytes = stickerQuery.data instanceof Uint8Array ? stickerQuery.data : undefined

  useEffect(() => {
    if (!bytes || !animated || !hostRef.current) return
    let active = true
    let destroy = () => {}
    void (async () => {
      const animationData = await new Response(
        new Blob([Uint8Array.from(bytes)]).stream().pipeThrough(new DecompressionStream('gzip')),
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
      destroy = () => animation.destroy()
    })().catch((error) => console.warn('[Telefast] Failed to render sticker', error))
    return () => {
      active = false
      destroy()
    }
  }, [animated, bytes])

  const label = `${sticker.emoji ? `${sticker.emoji} ` : ''}Sticker`
  return (
    <div
      ref={hostRef}
      class={compact
        ? `grid aspect-square place-items-center overflow-hidden ${largePreview ? 'size-32' : 'size-16'}`
        : 'grid place-items-center'
      }
      role="img"
      aria-label={label}
    >
      {sticker.sourceType === 'static' && source && <img class={compact ? 'size-full object-contain' : 'h-auto max-h-60 w-auto max-w-48 md:max-w-60 object-contain'} src={source} alt={label} decoding="async" />}
      {sticker.sourceType === 'video' && source && <video class={compact ? 'size-full object-contain' : 'h-auto max-h-60 w-auto max-w-48 md:max-w-60 object-contain'} src={source} autoPlay loop muted playsInline aria-label={label} />}
      {stickerQuery.isError && <span class="text-sm text-zinc-400">{label}</span>}
    </div>
  )
}
