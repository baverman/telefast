import { Long, SearchFilters, Sticker, type Dialog, type StickerSet, type tl } from '@mtcute/web'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/preact-query'
import { useMemo } from 'preact/hooks'
import { useTelegram } from './telegram-provider'
import { dialogId, isSupportedDialog } from './model'
import { appendMessage, cachedDialog, removeMessage, telegramKeys, upsertMessage, type HistoryPage, type StickerData } from './query-data'

async function loadDialogs(client: NonNullable<ReturnType<typeof useTelegram>['client']>) {
  const dialogs: Dialog[] = []
  for await (const dialog of client.iterDialogs()) {
    if (isSupportedDialog(dialog)) dialogs.push(dialog)
  }
  return dialogs
}

async function resolveDialog(
  client: NonNullable<ReturnType<typeof useTelegram>['client']>,
  queryClient: ReturnType<typeof useQueryClient>,
  peerId: string,
) {
  const cached = cachedDialog(queryClient, peerId)
  if (cached) return cached
  const numericPeerId = Number(peerId)
  if (!Number.isSafeInteger(numericPeerId)) throw new Error('Invalid Telegram peer')
  const [dialog] = await client.getPeerDialogs([numericPeerId])
  if (!dialog || !isSupportedDialog(dialog)) throw new Error('Telegram chat not found')
  queryClient.setQueryData<Dialog[]>(telegramKeys.dialogs(), (current = []) => (
    current.some((item) => dialogId(item) === peerId) ? current : [...current, dialog]
  ))
  return dialog
}

export function useDialogs() {
  const { client, status } = useTelegram()
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
        const hasCachedChat = Boolean(queryClient.getQueryData(telegramKeys.messages(id)))
        const hasResolvedDialog = resolved.some((item) => dialogId(item) === id)
        if ((hasCachedChat || hasResolvedDialog) && !next.some((item) => dialogId(item) === id)) next.push(dialog)
      })
      return next
    },
    enabled: status === 'authenticated' && Boolean(client),
    staleTime: 30_000,
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
    staleTime: Infinity,
    retry: false,
  })
}

type MessageWindowPageParam = {
  direction: 'center' | 'older' | 'newer'
  id: number
  date?: number
}

type MessageHistoryPage = Omit<HistoryPage, 'next'> & {
  next: HistoryPage['next'] | MessageWindowPageParam
  total?: number
  previous?: MessageWindowPageParam
}

function messageDate(message: import('@mtcute/web').Message) {
  return Math.floor(message.date.getTime() / 1000)
}

function useMessageHistory(peerId: string, threadId?: number, pinned = false, targetMessageId?: number) {
  const { client, status } = useTelegram()
  const queryClient = useQueryClient()
  const dialog = useDialog(peerId)
  const query = useInfiniteQuery({
    queryKey: targetMessageId != null
      ? telegramKeys.messageWindow(peerId, targetMessageId, threadId)
      : pinned
        ? telegramKeys.pinnedMessages(peerId, threadId)
        : telegramKeys.messages(peerId, threadId),
    queryFn: async ({ pageParam }): Promise<MessageHistoryPage> => {
      const target = dialog.data ?? await resolveDialog(client!, queryClient, peerId)

      if (targetMessageId != null) {
        const window = pageParam as MessageWindowPageParam
        let result
        if (threadId != null) {
          result = await client!.searchMessages({
            chatId: target.peer,
            threadId,
            limit: 50,
            offset: window.id,
            ...(window.direction === 'center' ? { addOffset: -25 } : {}),
            ...(window.direction === 'newer' ? { addOffset: -50 } : {}),
          })
        } else {
          let date = window.date
          if (date == null) {
            const [targetMessage] = await client!.getMessages(target.peer, window.id)
            if (!targetMessage) throw new Error('Message not found')
            date = messageDate(targetMessage)
          }
          result = await client!.getHistory(target.peer, {
            limit: 50,
            offset: { id: window.id, date },
            ...(window.direction === 'center' ? { addOffset: -25 } : {}),
            ...(window.direction === 'newer' ? { reverse: true } : {}),
          })
        }

        const messages = [...result].sort((left, right) => left.id - right.id)
        const oldest = messages[0]
        const newest = messages[messages.length - 1]
        const foundNewer = newest != null && newest.id > window.id
        return {
          messages,
          next: window.direction !== 'newer' && result.next && oldest
            ? { direction: 'older', id: oldest.id, date: messageDate(oldest) }
            : null,
          previous: window.direction !== 'older' && foundNewer && messages.length >= 49
            ? { direction: 'newer', id: newest.id, date: messageDate(newest) }
            : undefined,
        }
      }

      const result = pinned
        ? await client!.searchMessages({
          chatId: target.peer,
          threadId,
          filter: SearchFilters.Pinned,
          limit: 50,
          ...(pageParam ? { offset: pageParam as number } : {}),
        })
        : threadId != null
          ? await client!.searchMessages({
            chatId: target.peer,
            threadId,
            limit: 50,
            ...(pageParam ? { offset: pageParam as number } : {}),
          })
          : await client!.getHistory(target.peer, {
            limit: 50,
            ...(pageParam ? { offset: pageParam as Exclude<HistoryPage['next'], number | null> } : {}),
          })
      return {
        messages: [...result].reverse(),
        next: (result.next ?? null) as HistoryPage['next'],
        ...('total' in result ? { total: result.total } : {}),
      }
    },
    initialPageParam: targetMessageId != null
      ? { direction: 'center', id: targetMessageId } as MessageWindowPageParam
      : null as HistoryPage['next'],
    getNextPageParam: (page) => page.next ?? undefined,
    getPreviousPageParam: (page) => page.previous,
    enabled: status === 'authenticated' && Boolean(client && dialog.data),
    staleTime: Infinity,
  })

  const messages = useMemo(() => [...(query.data?.pages ?? [])]
    .reverse()
    .flatMap((page) => page.messages)
    .filter((message, index, all) => all.findIndex((item) => item.id === message.id) === index), [query.data])
  const total = query.data?.pages[0]?.total ?? messages.length

  return { ...query, messages, total, dialog: dialog.data, dialogError: dialog.error }
}

export function useMessages(peerId: string, threadId?: number, pinned = false, targetMessageId?: number) {
  return useMessageHistory(peerId, threadId, pinned, targetMessageId)
}

export function usePinnedMessages(peerId: string, threadId?: number) {
  return useMessageHistory(peerId, threadId, true)
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
    staleTime: 5 * 60_000,
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
    staleTime: 5 * 60_000,
  })
}


export function useStickerSet(sticker?: Sticker | null) {
  const { client, status } = useTelegram()
  return useQuery({
    queryKey: ['telegram', 'sticker-set', sticker?.uniqueFileId ?? ''],
    queryFn: () => client!.getStickerSet(sticker!.inputStickerSet!),
    enabled: status === 'authenticated' && Boolean(client && sticker?.hasStickerSet && sticker.inputStickerSet),
    staleTime: 5 * 60_000,
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
  const { client } = useTelegram()
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
      appendMessage(queryClient, peerId, message, threadId)
      void queryClient.invalidateQueries({ queryKey: telegramKeys.dialogs() })
    },
  })
}

export function useSendSticker(peerId: string) {
  const { client } = useTelegram()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (sticker: Sticker) => {
      const dialog = await resolveDialog(client!, queryClient, peerId)
      const sent = await client!.sendMedia(dialog.peer, sticker.inputMedia)
      return { sent, sticker }
    },
    onSuccess: ({ sent, sticker }) => {
      appendMessage(queryClient, peerId, sent)
      queryClient.setQueryData<StickerData>(telegramKeys.stickers(), (current) => current ? {
        ...current,
        recent: [sticker, ...current.recent.filter((item) => item.uniqueFileId !== sticker.uniqueFileId)],
      } : current)
      void queryClient.invalidateQueries({ queryKey: telegramKeys.dialogs() })
    },
  })
}

export function useSetMessagePinned(peerId: string, threadId?: number) {
  const { client } = useTelegram()
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
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: telegramKeys.pinnedMessages(peerId, threadId) }),
        queryClient.invalidateQueries({ queryKey: telegramKeys.messages(peerId, threadId) }),
        queryClient.invalidateQueries({ queryKey: telegramKeys.messageWindows(peerId) }),
      ])
    },
  })
}

export function useSendReaction(peerId: string, threadId?: number) {
  const { client } = useTelegram()
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
      if (updated) upsertMessage(queryClient, peerId, updated, threadId)
    },
  })
}

export function useEditMessage(peerId: string, threadId?: number) {
  const { client } = useTelegram()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ message, text }: { message: import('@mtcute/web').Message; text: string }) => (
      client!.editMessage({ message, text: text.trim() })
    ),
    onSuccess: (message) => {
      upsertMessage(queryClient, peerId, message, threadId)
      void queryClient.invalidateQueries({ queryKey: telegramKeys.dialogs() })
    },
  })
}

export function useDeleteMessage(peerId: string, threadId?: number) {
  const { client } = useTelegram()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ message, revoke }: { message: import('@mtcute/web').Message; revoke: boolean }) => {
      await client!.deleteMessages([message], { revoke })
      return message.id
    },
    onSuccess: (messageId) => {
      removeMessage(queryClient, peerId, messageId, threadId)
      void queryClient.invalidateQueries({ queryKey: telegramKeys.dialogs() })
    },
  })
}

export function useForwardMessage() {
  const { client } = useTelegram()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ message, toPeerId }: { message: import('@mtcute/web').Message; toPeerId: string }) => {
      const target = await resolveDialog(client!, queryClient, toPeerId)
      const forwarded = await client!.forwardMessages({ messages: [message], toChatId: target.peer })
      return { forwarded, toPeerId }
    },
    onSuccess: ({ forwarded, toPeerId }) => {
      forwarded.forEach((message) => appendMessage(queryClient, toPeerId, message))
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
    staleTime: 5 * 60_000,
    retry: 0,
  })
}
