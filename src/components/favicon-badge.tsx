import { useEffect } from 'preact/hooks'
import { useTelegram } from '../telegram/telegram-provider'
import { useDialogs } from '../telegram/queries'

const DEFAULT_FAVICON = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0ea5e9"/><path d="M19 18h26v7h-9v22h-8V25h-9z" fill="#ffffff"/></svg>',
)}`

function faviconLink() {
  const existing = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (existing) return existing
  const link = document.createElement('link')
  link.rel = 'icon'
  document.head.appendChild(link)
  return link
}

export function FaviconBadge() {
  const { status } = useTelegram()
  const dialogs = useDialogs()
  const unread = dialogs.data?.filter((dialog) => dialog.isMuted !== true).reduce((sum, dialog) => sum + dialog.unreadCount, 0) ?? 0

  useEffect(() => {
    const link = faviconLink()
    if (status !== 'authenticated' || unread === 0) {
      link.href = DEFAULT_FAVICON
      return
    }

    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const context = canvas.getContext('2d')
    if (!context) return

    context.beginPath()
    context.roundRect(0, 0, 64, 64, 14)
    context.fillStyle = '#0ea5e9'
    context.fill()
    context.fillStyle = '#ffffff'
    context.fillRect(19, 18, 26, 7)
    context.fillRect(28, 25, 8, 22)

    const label = unread > 99 ? '99+' : String(unread)
    context.beginPath()
    context.arc(52, 12, 12, 0, Math.PI * 2)
    context.fillStyle = '#ef4444'
    context.fill()
    context.lineWidth = 2
    context.strokeStyle = '#ffffff'
    context.stroke()
    context.fillStyle = '#ffffff'
    context.font = `700 ${label.length > 2 ? 11 : 12}px sans-serif`
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(label, 52, 12)

    link.href = canvas.toDataURL('image/png')
  }, [status, unread])

  return null
}
