import type { Dialog, Sticker, StickerSet } from '@mtcute/web'
import type { QueryClient } from '@tanstack/preact-query'

export interface StickerData {
  packs: StickerSet[]
  recent: Sticker[]
  favorites: Sticker[]
}

export const telegramKeys = {
  all: ['telegram'] as const,
  dialogs: () => ['telegram', 'dialogs'] as const,
  dialog: (peerId: string) => ['telegram', 'dialog', peerId] as const,
  pinnedMessages: (peerId: string, threadId?: number) => threadId != null
    ? ['telegram', 'pinned-messages', peerId, 'thread', String(threadId)] as const
    : ['telegram', 'pinned-messages', peerId] as const,
  stickers: () => ['telegram', 'stickers'] as const,
}

export function cachedDialog(queryClient: QueryClient, peerId: string) {
  return queryClient.getQueryData<Dialog[]>(telegramKeys.dialogs())?.find((dialog) => String(dialog.peer.id) === peerId)
}
