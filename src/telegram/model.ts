import type { Dialog, Message } from '@mtcute/web'

export function dialogId(dialog: Dialog) {
  return String(dialog.peer.id)
}

export function isGroupPeer(peer: Dialog['peer']) {
  return peer.type === 'chat' && peer.isGroup
}

export function isSupportedPeer(peer: Dialog['peer']) {
  return peer.type === 'user' || isGroupPeer(peer)
}

export function isSupportedDialog(dialog: Dialog) {
  return isSupportedPeer(dialog.peer)
}

export function messageText(message?: Message | null) {
  if (!message) return ''
  if (message.text) return message.text
  if (message.media?.type === 'sticker') {
    return `${message.media.emoji ? `${message.media.emoji} ` : ''}Sticker`
  }
  return message.media ? 'Attachment' : ''
}
