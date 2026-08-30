import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { Dialog, Message } from '@mtcute/web'
import type { TelefastClient } from '../telegram'

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

const avatarUrls = new Map<string, string>()
const avatarRequests = new Map<string, Promise<string>>()

function requestAvatar(telegram: TelefastClient, peer: Dialog['peer']) {
  const photo = peer.photo
  if (!photo) return Promise.resolve('')
  const key = photo.small.uniqueFileId
  const cached = avatarUrls.get(key)
  if (cached) return Promise.resolve(cached)
  const pending = avatarRequests.get(key)
  if (pending) return pending

  const request = telegram.downloadAsBuffer(photo.small)
    .then((bytes) => {
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
  const photoKey = peer.photo?.small.uniqueFileId ?? ''
  const [source, setSource] = useState(() => avatarUrls.get(photoKey) ?? '')

  useEffect(() => {
    setSource(avatarUrls.get(photoKey) ?? '')
    if (!telegram || !photoKey || !peer.photo) return
    let active = true
    const load = () => {
      void requestAvatar(telegram, peer)
        .then((url) => { if (active) setSource(url) })
        .catch((error) => console.warn('[Telefast] Failed to load avatar', error))
    }
    const host = hostRef.current
    if (!host || typeof IntersectionObserver === 'undefined') {
      load()
      return () => { active = false }
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
  const [source, setSource] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!telegram) return
    let active = true
    let objectUrl = ''
    let cleanup = () => {}

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
        cleanup = () => animation.destroy()
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
      cleanup = () => observer.disconnect()
    }

    return () => {
      active = false
      cleanup()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [sticker, telegram])

  const label = `${sticker.emoji ? `${sticker.emoji} ` : ''}Sticker`
  return (
    <div
      ref={hostRef}
      class={compact
        ? `grid aspect-square place-items-center overflow-hidden ${largePreview ? 'size-32' : 'size-16'}`
        : 'grid aspect-square w-48 max-w-[60vw] place-items-center overflow-hidden md:w-60'
      }
      role="img"
      aria-label={label}
    >
      {sticker.sourceType === 'static' && source && <img class="size-full object-contain" src={source} alt={label} decoding="async" />}
      {sticker.sourceType === 'video' && source && <video class="size-full object-contain" src={source} autoPlay loop muted playsInline aria-label={label} />}
      {failed && <span class="text-sm text-zinc-400">{label}</span>}
    </div>
  )
}
