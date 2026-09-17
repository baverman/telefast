import { InputMedia, Long, SearchFilters, Sticker, type Dialog, type Message, type StickerSet, type tl } from '@mtcute/web'
import { useMutation, useQuery, useQueryClient } from '@tanstack/preact-query'
import { chunkForMessage } from './message-store'
import { useTelegram, messageStoreKey } from './telegram-provider'
import { dialogId, isSupportedDialog } from './model'
import { cachedDialog, telegramKeys, type StickerData } from './query-data'
import { resolveDialog } from './resolve-dialog'

async function loadDialogs(client: NonNullable<ReturnType<typeof useTelegram>['client']>) {
  const dialogs: Dialog[] = []
  for await (const dialog of client.iterDialogs()) {
    if (isSupportedDialog(dialog)) dialogs.push(dialog)
  }
  return dialogs
}

export function useDialogs() {
  const { client, status, messageStores } = useTelegram()
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: telegramKeys.dialogs(),
    queryFn: async () => {
      const next = await loadDialogs(client!)
      const current = queryClient.getQueryData<Dialog[]>(telegramKeys.dialogs()) ?? []
      const resolved = queryClient.getQueriesData<Dialog>({ queryKey: ['telegram', 'dialog'] })
        .flatMap(([, dialog]) => dialog ? [dialog] : [])
      const retained = [...current, ...resolved]
      retained.forEach((dialog) => {
        const id = dialogId(dialog)
        const hasCachedChat = (messageStores.get(id)?.chunks.length ?? 0) > 0
        const hasResolvedDialog = resolved.some((item) => dialogId(item) === id)
        if ((hasCachedChat || hasResolvedDialog) && !next.some((item) => dialogId(item) === id)) next.push(dialog)
      })
      return next
    },
    enabled: status === 'authenticated' && Boolean(client),
  })
}

export function useDialog(peerId?: string) {
  const { client, status } = useTelegram()
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: telegramKeys.dialog(peerId ?? ''),
    queryFn: () => resolveDialog(client!, queryClient, peerId!),
    enabled: status === 'authenticated' && Boolean(client && peerId),
    initialData: peerId ? cachedDialog(queryClient, peerId) : undefined,
    retry: false,
  })
}

/**
 * Number of pinned messages in a chat. The header shows this count. It is not
 * backed by the message store.
 */
export function usePinnedMessageCount(peerId: string, threadId?: number) {
  const { client, status } = useTelegram()
  return useQuery({
    queryKey: telegramKeys.pinnedMessages(peerId, threadId),
    queryFn: async () => {
      const options = {
        chatId: Number(peerId),
        threadId,
        filter: SearchFilters.Pinned,
        limit: 1,
      }
      console.log('Pinned message count searchMessages', options)
      const result = await client!.searchMessages(options)
      if ('total' in result && typeof result.total === 'number') return result.total
      return [...result].length
    },
    enabled: status === 'authenticated' && Boolean(client),
  })
}

export function useCanPinMessages(peerId: string) {
  const { client, status } = useTelegram()
  const dialog = useDialog(peerId)
  return useQuery({
    queryKey: ['telegram', 'can-pin-messages', peerId],
    queryFn: async () => {
      const peer = dialog.data!.peer
      if (peer.type === 'user') {
        const full = await client!.getFullUser(peer)
        return full.full._ === 'userFull' && full.full.canPinMessage === true
      }
      return peer.isCreator
        || peer.adminRights?.pinMessages === true
        || peer.permissions?.canPinMessages === true
    },
    enabled: status === 'authenticated' && Boolean(client && dialog.data),
  })
}

function stickersFromRaw(documents: tl.TypeDocument[]) {
  return documents.flatMap((document) => {
    if (document._ !== 'document') return []
    const stickerAttribute = document.attributes.find(
      (attribute) => attribute._ === 'documentAttributeSticker' || attribute._ === 'documentAttributeCustomEmoji',
    )
    if (!stickerAttribute) return []
    const sizeAttribute = document.attributes.find(
      (attribute) => attribute._ === 'documentAttributeImageSize' || attribute._ === 'documentAttributeVideo',
    )
    return [new Sticker(document, stickerAttribute, sizeAttribute)]
  })
}

export function useStickers() {
  const { client, status } = useTelegram()
  return useQuery({
    queryKey: telegramKeys.stickers(),
    queryFn: async (): Promise<StickerData> => {
      const [installed, recent, favorites] = await Promise.all([
        client!.getInstalledStickers(),
        client!.call({ _: 'messages.getRecentStickers', attached: false, hash: Long.ZERO }),
        client!.call({ _: 'messages.getFavedStickers', hash: Long.ZERO }),
      ])
      const packs = await Promise.allSettled(
        installed.filter((pack) => !pack.isArchived).map((pack) => client!.getStickerSet(pack)),
      )
      return {
        packs: packs.flatMap((result) => result.status === 'fulfilled' ? [result.value as StickerSet] : []),
        recent: recent._ === 'messages.recentStickers' ? stickersFromRaw(recent.stickers) : [],
        favorites: favorites._ === 'messages.favedStickers' ? stickersFromRaw(favorites.stickers) : [],
      }
    },
    enabled: status === 'authenticated' && Boolean(client),
  })
}


export function useStickerSet(sticker?: Sticker | null) {
  const { client, status } = useTelegram()
  return useQuery({
    queryKey: ['telegram', 'sticker-set', sticker?.uniqueFileId ?? ''],
    queryFn: () => client!.getStickerSet(sticker!.inputStickerSet!),
    enabled: status === 'authenticated' && Boolean(client && sticker?.hasStickerSet && sticker.inputStickerSet),
    retry: false,
  })
}

export function useSetStickerPackInstalled() {
  const { client } = useTelegram()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ pack, installed }: { pack: StickerSet; installed: boolean }) => {
      if (installed) {
        await client!.call({ _: 'messages.installStickerSet', stickerset: pack.inputStickerSet, archived: false })
      } else {
        await client!.call({ _: 'messages.uninstallStickerSet', stickerset: pack.inputStickerSet })
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: telegramKeys.stickers() })
    },
  })
}

function commandEntity(text: string) {
  const match = text.match(/^\/([a-zA-Z0-9_]+)(?:@[a-zA-Z0-9_]+)?/)
  if (!match) return null
  return { _: 'messageEntityBotCommand' as const, offset: 0, length: match[0].length }
}

export interface MessageReplyTarget {
  message: import('@mtcute/web').Message
  quote?: { start: number; end: number; text: string }
}

export interface SendTextInput {
  text: string
  reply?: MessageReplyTarget
}

export function useSendText(peerId: string, threadId?: number) {
  const { client, messageStores } = useTelegram()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ text, reply }: SendTextInput) => {
      const dialog = await resolveDialog(client!, queryClient, peerId)
      const trimmed = text.trim()
      const entity = commandEntity(trimmed)
      const input = entity ? { text: trimmed, entities: [entity] } : trimmed
      const options = threadId != null ? { threadId } : undefined
      if (reply?.quote) {
        return client!.quoteWithText(reply.message, {
          text: input,
          start: reply.quote.start,
          end: reply.quote.end,
          ...options,
        })
      }
      if (reply) return client!.replyText(reply.message, input, options)
      return client!.sendText(dialog.peer, input, options)
    },
    onSuccess: (message) => {
      const store = messageStores.get(messageStoreKey(peerId, threadId))
      if (store) store.update(chunkForMessage(message))
      void queryClient.invalidateQueries({ queryKey: telegramKeys.dialogs() })
    },
  })
}

export interface SendAttachmentsInput {
  files: File[]
  caption?: string
  reply?: MessageReplyTarget
  onFileSent?: (file: File, index: number) => void
  onProgress?: (index: number, uploaded: number, total: number) => void
}

function attachmentMedia(file: File) {
  const metadata = {
    fileName: file.name,
    fileMime: file.type || 'application/octet-stream',
    fileSize: file.size,
  }
  return InputMedia.document(file, metadata)
}

export function useSendAttachments(peerId: string, threadId?: number) {
  const { client, messageStores } = useTelegram()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ files, caption, reply, onFileSent, onProgress }: SendAttachmentsInput) => {
      const dialog = await resolveDialog(client!, queryClient, peerId)
      const sent: Message[] = []

      for (const [index, file] of files.entries()) {
        const quote = index === 0 && reply?.quote
          ? { text: reply.quote.text }
          : undefined
        const message = await client!.sendMedia(dialog.peer, attachmentMedia(file), {
          caption: index === 0 ? caption?.trim() || undefined : undefined,
          threadId,
          replyTo: index === 0 ? reply?.message : undefined,
          quote,
          quoteOffset: quote ? reply!.quote!.start : undefined,
          progressCallback: (uploaded, total) => onProgress?.(index, uploaded, total),
        })
        sent.push(message)
        const store = messageStores.get(messageStoreKey(peerId, threadId))
        if (store) store.update(chunkForMessage(message))
        onFileSent?.(file, index)
      }

      return sent
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: telegramKeys.dialogs() })
    },
  })
}

export function useSendSticker(peerId: string) {
  const { client, messageStores } = useTelegram()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (sticker: Sticker) => {
      const dialog = await resolveDialog(client!, queryClient, peerId)
      const sent = await client!.sendMedia(dialog.peer, sticker.inputMedia)
      return { sent, sticker }
    },
    onSuccess: ({ sent, sticker }) => {
      const store = messageStores.get(messageStoreKey(peerId))
      if (store) store.update(chunkForMessage(sent))
      queryClient.setQueryData<StickerData>(telegramKeys.stickers(), (current) => current ? {
        ...current,
        recent: [sticker, ...current.recent.filter((item) => item.uniqueFileId !== sticker.uniqueFileId)],
      } : current)
      void queryClient.invalidateQueries({ queryKey: telegramKeys.dialogs() })
    },
  })
}

export function useSetMessagePinned(peerId: string, threadId?: number) {
  const { client, messageStores } = useTelegram()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ message, pinned }: { message: import('@mtcute/web').Message; pinned: boolean }) => {
      const dialog = await resolveDialog(client!, queryClient, peerId)
      if (pinned) {
        return client!.pinMessage({
          message,
          notify: false,
          bothSides: dialog.peer.type === 'user',
          shouldDispatch: true,
        })
      }
      await client!.unpinMessage({ message })
      return null
    },
    onSuccess: async (_result, { message, pinned }) => {
      if (message.raw._ === 'message') message.raw.pinned = pinned
      const store = messageStores.get(messageStoreKey(peerId, threadId))
      if (store) store.update(chunkForMessage(message))
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: telegramKeys.pinnedMessages(peerId, threadId) }),
      ])
    },
  })
}

export function useSendReaction(peerId: string, threadId?: number) {
  const { client, messageStores } = useTelegram()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ messageId, emoji, remove }: { messageId: number; emoji: string; remove: boolean }) => {
      const dialog = await resolveDialog(client!, queryClient, peerId)
      return client!.sendReaction({
        chatId: dialog.peer,
        message: messageId,
        emoji: remove ? null : emoji,
      })
    },
    onSuccess: (updated) => {
      const store = messageStores.get(messageStoreKey(peerId, threadId))
      if (updated && store) store.update(chunkForMessage(updated))
    },
  })
}

export function useEditMessage(peerId: string, threadId?: number) {
  const { client, messageStores } = useTelegram()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ message, text }: { message: import('@mtcute/web').Message; text: string }) => (
      client!.editMessage({ message, text: text.trim() })
    ),
    onSuccess: (message) => {
      const store = messageStores.get(messageStoreKey(peerId, threadId))
      if (store) store.update(chunkForMessage(message))
      void queryClient.invalidateQueries({ queryKey: telegramKeys.dialogs() })
    },
  })
}

export function useDeleteMessage(peerId: string, threadId?: number) {
  const { client, messageStores } = useTelegram()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ message, revoke }: { message: import('@mtcute/web').Message; revoke: boolean }) => {
      await client!.deleteMessages([message], { revoke })
      return message.id
    },
    onSuccess: async (messageId) => {
      messageStores.get(messageStoreKey(peerId, threadId))?.remove(messageId)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: telegramKeys.dialogs() }),
        queryClient.invalidateQueries({ queryKey: telegramKeys.pinnedMessages(peerId, threadId) }),
      ])
    }
  })
}

export function useForwardMessage() {
  const { client, messageStores } = useTelegram()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ message, toPeerId }: { message: import('@mtcute/web').Message; toPeerId: string }) => {
      const target = await resolveDialog(client!, queryClient, toPeerId)
      const forwarded = await client!.forwardMessages({ messages: [message], toChatId: target.peer })
      return { forwarded, toPeerId }
    },
    onSuccess: ({ forwarded, toPeerId }) => {
      const store = messageStores.get(messageStoreKey(toPeerId))
      if (store) forwarded.forEach((message) => store.update(chunkForMessage(message)))
      void queryClient.invalidateQueries({ queryKey: telegramKeys.dialogs() })
    },
  })
}

export function useBotCommands(peerId: string) {
  const { client, status } = useTelegram()
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: ['telegram', 'bot-commands', peerId],
    queryFn: async () => {
      const dialog = await resolveDialog(client!, queryClient, peerId)
      if (dialog.peer.type === 'chat') {
        const full = await client!.getFullChat(dialog.peer)
        return full.botInfo.flatMap((bot) => bot.commands.map((command) => ({ name: command.command, description: command.description })))
      }
      if (dialog.peer.type === 'user' && dialog.peer.isBot) {
        const full = await client!.getFullUser(dialog.peer)
        return (full.full.botInfo?.commands ?? []).map((command) => ({ name: command.command, description: command.description }))
      }
      return []
    },
    enabled: status === 'authenticated' && Boolean(client),
    retry: 0,
  })
}
