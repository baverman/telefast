import type { Dialog, Message } from '@mtcute/web'

export function dialogId(dialog: Dialog) {
  return String(dialog.peer.id)
}

export function isGroupPeer(peer: Dialog['peer']) {
  return peer.type === 'chat' && peer.isGroup
}

export function isBroadcastChannel(peer: Dialog['peer']) {
  return peer.type === 'chat' && peer.chatType === 'channel'
}

export function canSendMessages(peer: Dialog['peer']) {
  if (peer.type !== 'chat') return true
  if (peer.chatType === 'channel') return peer.isCreator || peer.adminRights?.postMessages === true
  return peer.permissions == null || peer.permissions.canSendMessages
}

export function isSupportedPeer(peer: Dialog['peer']) {
  return peer.type === 'user' || (peer.type === 'chat' && peer.chatType !== 'community')
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
