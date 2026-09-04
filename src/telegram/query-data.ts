import type { Dialog, Message, Sticker, StickerSet } from '@mtcute/web'
import type { InfiniteData, QueryClient } from '@tanstack/preact-query'

export interface HistoryPage {
  messages: Message[]
  next: { id: number; date: number } | number | null
}

export interface StickerData {
  packs: StickerSet[]
  recent: Sticker[]
  favorites: Sticker[]
}

export const telegramKeys = {
  all: ['telegram'] as const,
  dialogs: () => ['telegram', 'dialogs'] as const,
  dialog: (peerId: string) => ['telegram', 'dialog', peerId] as const,
  messages: (peerId: string, threadId?: number) => threadId != null
    ? ['telegram', 'messages', peerId, 'thread', String(threadId)] as const
    : ['telegram', 'messages', peerId] as const,
  stickers: () => ['telegram', 'stickers'] as const,
}

export function appendMessage(queryClient: QueryClient, peerId: string, message: Message, threadId?: number) {
  queryClient.setQueryData<InfiniteData<HistoryPage, HistoryPage['next']>>(
    telegramKeys.messages(peerId, threadId),
    (current) => {
      if (!current || current.pages.some((page) => page.messages.some((item) => item.id === message.id))) return current
      const pages = [...current.pages]
      pages[0] = { ...pages[0], messages: [...pages[0].messages, message] }
      return { ...current, pages }
    },
  )
}

export function upsertMessage(queryClient: QueryClient, peerId: string, message: Message, threadId?: number) {
  queryClient.setQueryData<InfiniteData<HistoryPage, HistoryPage['next']>>(
    telegramKeys.messages(peerId, threadId),
    (current) => {
      if (!current) return current
      const pages = current.pages.map((page) => ({
        ...page,
        messages: page.messages.map((item) => item.id === message.id ? message : item),
      }))
      if (!pages.some((page) => page.messages.some((item) => item.id === message.id))) {
        pages[0] = { ...pages[0], messages: [...pages[0].messages, message] }
      }
      return { ...current, pages }
    },
  )
}

export function removeMessage(queryClient: QueryClient, peerId: string, messageId: number, threadId?: number) {
  queryClient.setQueryData<InfiniteData<HistoryPage, HistoryPage['next']>>(
    telegramKeys.messages(peerId, threadId),
    (current) => current ? {
      ...current,
      pages: current.pages.map((page) => ({
        ...page,
        messages: page.messages.filter((message) => message.id !== messageId),
      })),
    } : current,
  )
}

export function cachedDialog(queryClient: QueryClient, peerId: string) {
  return queryClient.getQueryData<Dialog[]>(telegramKeys.dialogs())?.find((dialog) => String(dialog.peer.id) === peerId)
}
