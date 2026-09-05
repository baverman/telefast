import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import type { Dialog, Message } from '@mtcute/web'
import { useTelegram, isGroupPeer } from '../telegram/telegram-provider'
import { useMessages, type MessageReplyTarget } from '../telegram/queries'
import { Avatar, StickerView, timeLabel } from './media'
import { MessageContent } from './message-content'
import { ReactionBar, MessageContextMenu } from './reaction-bar'
import { MessageMetadata } from './message-metadata'

function selectedQuote(article: HTMLElement | null, message: Message): MessageReplyTarget['quote'] | undefined {
  const selection = window.getSelection()
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null
  const textRoot = article?.querySelector<HTMLElement>('[data-message-text]')
  if (!selection || selection.isCollapsed || !range || !textRoot?.contains(range.commonAncestorContainer)) return undefined

  const prefix = range.cloneRange()
  prefix.selectNodeContents(textRoot)
  prefix.setEnd(range.startContainer, range.startOffset)
  const start = prefix.toString().length
  const text = selection.toString()
  const end = start + text.length
  if (!text || start < 0 || end > message.text.length) return undefined
  return { start, end, text }
}

export function MessageList({
  peerId,
  dialog,
  threadId,
  targetMessageId,
  pinned = false,
  searchQuery,
  canPinMessages = false,
  onReply,
  onEdit,
}: {
  peerId: string
  dialog: Dialog
  threadId?: number
  targetMessageId?: number
  pinned?: boolean
  searchQuery?: string
  canPinMessages?: boolean
  onReply: (reply: MessageReplyTarget) => void
  onEdit: (message: Message) => void
}) {
  const { client } = useTelegram()
  const location = useLocation()
  const history = useMessages(peerId, threadId, pinned, pinned ? undefined : targetMessageId, searchQuery)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const olderSentinelRef = useRef<HTMLDivElement | null>(null)
  const newerSentinelRef = useRef<HTMLDivElement | null>(null)
  const previousLatestIdRef = useRef<number>()
  const nearBottomRef = useRef(true)
  const pendingOlderScrollRef = useRef<{
    messageId?: string
    oldestMessageId?: number
    offset: number
    scrollHeight: number
    scrollTop: number
  } | null>(null)
  const selectedQuoteRef = useRef<MessageReplyTarget['quote']>()
  const [reactionMenu, setReactionMenu] = useState<{
    message: Message
    quote?: MessageReplyTarget['quote']
    x: number
    y: number
    placement: 'above' | 'below'
  } | null>(null)
  const [showScrollToLatest, setShowScrollToLatest] = useState(false)
  const initialScrollRef = useRef({
    key: '',
    lastReadIngoing: 0,
    hasUnread: false,
    targetMessageId: undefined as number | undefined,
    done: false,
  })
  const chatKey = `${peerId}:${threadId ?? ''}:${targetMessageId ?? ''}:${pinned ? 'pinned' : searchQuery ?? 'history'}`

  if (initialScrollRef.current.key !== chatKey) {
    initialScrollRef.current = {
      key: chatKey,
      lastReadIngoing: dialog.lastReadIngoing,
      hasUnread: !pinned && searchQuery == null && threadId == null && dialog.unreadCount > 0,
      targetMessageId,
      done: false,
    }
    previousLatestIdRef.current = undefined
    pendingOlderScrollRef.current = null
    nearBottomRef.current = true
  }

  async function openComments(post: Message) {
    if (!client) return
    try {
      const discussion = await client.getDiscussionMessage({ message: post })
      if (!discussion) return
      location.route(`/chat/${String(discussion.chat.id)}?thread=${discussion.id}`)
    } catch (error) {
      console.error('[Telefast] Failed to open comments', error)
    }
  }

  function updateNearBottom(container: HTMLDivElement) {
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 120
    nearBottomRef.current = nearBottom
    setShowScrollToLatest(!nearBottom)
    return nearBottom
  }

  const loadOlder = useCallback(() => {
    const container = containerRef.current
    if (
      !container
      || !initialScrollRef.current.done
      || !history.hasNextPage
      || history.isFetchingNextPage
      || pendingOlderScrollRef.current
    ) return

    const containerTop = container.getBoundingClientRect().top
    const firstVisible = [...container.querySelectorAll<HTMLElement>('[data-message-id]')]
      .find((message) => message.getBoundingClientRect().bottom > containerTop)

    pendingOlderScrollRef.current = {
      messageId: firstVisible?.dataset.messageId,
      oldestMessageId: history.messages[0]?.id,
      offset: firstVisible ? firstVisible.getBoundingClientRect().top - containerTop : 0,
      scrollHeight: container.scrollHeight,
      scrollTop: container.scrollTop,
    }

    void history.fetchNextPage().catch(() => {
      pendingOlderScrollRef.current = null
    })
  }, [history.fetchNextPage, history.hasNextPage, history.isFetchingNextPage, history.messages])

  const loadNewer = useCallback(() => {
    if (!targetMessageId || !history.hasPreviousPage || history.isFetchingPreviousPage) return
    void history.fetchPreviousPage()
  }, [history.fetchPreviousPage, history.hasPreviousPage, history.isFetchingPreviousPage, targetMessageId])

  useEffect(() => {
    const container = containerRef.current
    const sentinel = olderSentinelRef.current
    if (!container || !sentinel || !history.hasNextPage) return

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadOlder()
    }, { root: container, rootMargin: '160px 0px 0px' })

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [history.hasNextPage, loadOlder])

  useEffect(() => {
    const container = containerRef.current
    const sentinel = newerSentinelRef.current
    if (!container || !sentinel || !history.hasPreviousPage) return

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadNewer()
    }, { root: container, rootMargin: '0px 0px 160px' })

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [history.hasPreviousPage, loadNewer])

  useLayoutEffect(() => {
    const container = containerRef.current
    const latestMessage = history.messages[history.messages.length - 1]
    const previousLatestId = previousLatestIdRef.current
    const latestChanged = previousLatestId != null && latestMessage?.id !== previousLatestId
    const isNewOutgoing = !pinned && searchQuery == null && targetMessageId == null && latestChanged && latestMessage?.isOutgoing === true
    previousLatestIdRef.current = latestMessage?.id

    if (!container || history.messages.length === 0) return

    const pendingOlderScroll = pendingOlderScrollRef.current
    if (pendingOlderScroll) {
      const oldestChanged = history.messages[0]?.id !== pendingOlderScroll.oldestMessageId
      if (!oldestChanged && history.isFetchingNextPage) return
      if (!oldestChanged) {
        pendingOlderScrollRef.current = null
        return
      }
      const anchor = pendingOlderScroll.messageId
        ? container.querySelector<HTMLElement>(`[data-message-id="${pendingOlderScroll.messageId}"]`)
        : null

      if (anchor) {
        const nextOffset = anchor.getBoundingClientRect().top - container.getBoundingClientRect().top
        container.scrollTop += nextOffset - pendingOlderScroll.offset
      } else {
        container.scrollTop = pendingOlderScroll.scrollTop
          + container.scrollHeight - pendingOlderScroll.scrollHeight
      }
      pendingOlderScrollRef.current = null
      nearBottomRef.current = false
      setShowScrollToLatest(true)
      return
    }

    const initialScroll = initialScrollRef.current
    if (!initialScroll.done) {
      if (initialScroll.targetMessageId != null) {
        const targetMessage = history.messages.find((message) => message.id === initialScroll.targetMessageId)

        const target = targetMessage
          ? container.querySelector<HTMLElement>(`[data-message-id="${targetMessage.id}"]`)
          : null
        if (target) target.scrollIntoView({ block: 'center' })
        else container.scrollTop = container.scrollHeight
        initialScroll.done = true
        updateNearBottom(container)
        return
      }
      if (initialScroll.hasUnread) {
        const oldestMessage = history.messages[0]
        if (oldestMessage.id > initialScroll.lastReadIngoing && history.hasNextPage) {
          if (!history.isFetchingNextPage) void history.fetchNextPage()
          return
        }

        const firstUnread = history.messages.find((message) => (
          !message.isOutgoing && message.id > initialScroll.lastReadIngoing
        ))
        const target = firstUnread
          ? container.querySelector<HTMLElement>(`[data-message-id="${firstUnread.id}"]`)
          : null
        if (target) target.scrollIntoView({ block: 'start' })
        else container.scrollTop = container.scrollHeight
      } else {
        container.scrollTop = container.scrollHeight
      }
      initialScroll.done = true
      updateNearBottom(container)
      return
    }

    if (targetMessageId != null && latestChanged) {
      updateNearBottom(container)
      return
    }

    if (isNewOutgoing || (latestChanged && nearBottomRef.current)) {
      container.scrollTop = container.scrollHeight
      nearBottomRef.current = true
      setShowScrollToLatest(false)
    }
  }, [history.messages, history.hasNextPage, history.isFetchingNextPage])

  return (
    <div class="relative min-h-0 flex-1">
      <div
        ref={containerRef}
        class="h-full overflow-y-auto px-4 py-6 md:px-8"
        onScroll={(event) => {
          const container = event.currentTarget
          updateNearBottom(container)
          if (container.scrollTop < 160) loadOlder()
        }}
      >
        <div class="mx-auto flex min-h-full max-w-3xl flex-col justify-end gap-4">
        {history.hasNextPage && (
          <div ref={olderSentinelRef} class="flex min-h-px justify-center">
            {history.isFetchingNextPage && (
              <span class="mb-4 rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs text-zinc-300">
                Loading older messages…
              </span>
            )}
          </div>
        )}
        {history.isPending && <p class="my-auto text-center text-sm text-zinc-500">Loading messages…</p>}
        {history.isError && <p class="my-auto text-center text-sm text-red-300">Failed to load messages.</p>}
        {!history.isPending && !history.isError && history.messages.length === 0 && (
          <p class="my-auto text-center text-sm text-zinc-500">
            {pinned ? 'No pinned messages' : searchQuery != null ? 'No search results' : 'No messages'}
          </p>
        )}
        {history.messages.map((message) => (
          <article
            key={message.id}
            data-message-id={message.id}
            class={`${message.isService
              ? 'message-service'
              : `group relative ${message.media?.type === 'sticker'
                  ? `sticker-message ${message.isOutgoing ? 'sticker-out' : 'sticker-in'}`
                  : `message-bubble ${message.isOutgoing ? 'message-out' : 'message-in'}`}`
            }${message.id === targetMessageId ? ' target-message' : ''}`}
          >
            {isGroupPeer(dialog.peer) && !message.isService && (
              <a
                href={`/chat/${encodeURIComponent(String(message.sender.id))}/info`}
                class={`absolute top-0 ${message.isOutgoing ? '-right-11' : '-left-11'}`}
                title={`Open information about ${message.sender.displayName}`}
                aria-label={`Open information about ${message.sender.displayName}`}
              >
                <Avatar
                  peer={message.sender}
                  telegram={client}
                  className="grid size-8 place-items-center rounded-full bg-gradient-to-br from-sky-500 to-indigo-500 text-[10px] font-semibold text-white"
                />
              </a>
            )}
            {!message.isService && (
              <button
                type="button"
                class={`absolute right-1 top-1 z-10 grid size-6 place-items-center rounded-full border border-zinc-700 bg-zinc-900 text-zinc-400 shadow-md transition hover:bg-zinc-800 hover:text-zinc-100 focus:opacity-100 ${
                  reactionMenu?.message.id === message.id
                    ? 'opacity-100'
                    : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100'
                }`}
                aria-label="Message actions"
                aria-expanded={reactionMenu?.message.id === message.id}
                onMouseDown={(event) => {
                  selectedQuoteRef.current = selectedQuote(event.currentTarget.closest('article'), message)
                }}
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect()
                  const placement = rect.top >= 240 ? 'above' : 'below'
                  setReactionMenu({
                    message,
                    quote: selectedQuoteRef.current,
                    x: Math.min(Math.max(rect.left + rect.width / 2, 124), window.innerWidth - 124),
                    y: placement === 'above' ? rect.top - 4 : rect.bottom + 4,
                    placement,
                  })
                  selectedQuoteRef.current = undefined
                }}
              >
                <svg aria-hidden="true" viewBox="0 0 20 20" class="size-4" fill="currentColor">
                  <circle cx="4" cy="10" r="1.5" />
                  <circle cx="10" cy="10" r="1.5" />
                  <circle cx="16" cy="10" r="1.5" />
                </svg>
              </button>
            )}
            {isGroupPeer(dialog.peer) && !message.isOutgoing && (
              <a
                href={`/chat/${encodeURIComponent(String(message.sender.id))}/info`}
                class="mb-1 block w-fit text-xs font-medium text-sky-300 underline-offset-2 hover:underline"
                title={`Open information about ${message.sender.displayName}`}
              >
                {message.sender.displayName}
              </a>
            )}
            {!message.isService && <MessageMetadata message={message} telegram={client} />}
            {message.media?.type === 'sticker' ? (
              <StickerView sticker={message.media} telegram={client} />
            ) : (
              <MessageContent message={message} telegram={client} />
            )}
            <div class="mt-1 flex flex-wrap items-center gap-1">
              {message.replies?.hasComments && message.replies.discussion != null && (
                <button
                  type="button"
                  class="inline-flex items-center gap-1 rounded-full bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-400 hover:text-sky-300"
                  onClick={() => void openComments(message)}
                >
                  💬 {message.replies.count > 0 ? message.replies.count : 'Comments'}
                </button>
              )}
              {!message.isService && <ReactionBar message={message} peerId={peerId} threadId={threadId} />}
              <time
                class="ml-auto text-[10px] text-zinc-400/80"
                dateTime={message.date.toISOString()}
                title={message.date.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'long' })}
              >
                {timeLabel(message.date)}
              </time>
            </div>
          </article>
        ))}
        {targetMessageId != null && history.hasPreviousPage && (
          <div ref={newerSentinelRef} class="flex min-h-px justify-center">
            {history.isFetchingPreviousPage && (
              <span class="mt-4 rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs text-zinc-300">
                Loading newer messages…
              </span>
            )}
          </div>
        )}
        {reactionMenu && (
          <MessageContextMenu
            message={reactionMenu.message}
            peerId={peerId}
            threadId={threadId}
            quote={reactionMenu.quote}
            x={reactionMenu.x}
            y={reactionMenu.y}
            placement={reactionMenu.placement}
            pinnedView={pinned}
            filteredView={pinned || searchQuery != null}
            canPinMessages={canPinMessages}
            onJump={pinned || searchQuery != null ? () => {
              const query = new URLSearchParams()
              if (threadId != null) query.set('thread', String(threadId))
              query.set('message', String(reactionMenu.message.id))
              location.route(`/chat/${encodeURIComponent(peerId)}?${query}`)
            } : undefined}
            onReply={onReply}
            onEdit={onEdit}
            onClose={() => setReactionMenu(null)}
          />
        )}
        </div>
      </div>
      {showScrollToLatest && (
        <button
          type="button"
          class="absolute bottom-4 right-4 z-20 grid size-11 place-items-center rounded-full border border-zinc-700 bg-zinc-900/95 text-xl text-zinc-100 shadow-lg shadow-black/40 backdrop-blur transition hover:bg-zinc-800 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
          aria-label={targetMessageId != null ? 'Go to latest messages' : 'Scroll to latest messages'}
          title={targetMessageId != null ? 'Go to latest messages' : 'Scroll to latest messages'}
          onClick={() => {
            if (targetMessageId != null) {
              const query = new URLSearchParams()
              if (threadId != null) query.set('thread', String(threadId))
              location.route(`/chat/${encodeURIComponent(peerId)}${query.size ? `?${query}` : ''}`)
              return
            }
            containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight, behavior: 'smooth' })
          }}
        >
          ↓
        </button>
      )}
    </div>
  )
}
