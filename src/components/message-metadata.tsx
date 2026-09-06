import { useQuery } from '@tanstack/preact-query'
import type { Message } from '@mtcute/web'
import type { TelefastClient } from '../telegram'

function messagePreview(message: Message | null | undefined, fallback = '') {
  const text = message?.text.trim() || fallback.trim()
  if (text) return text.replace(/\s+/g, ' ')

  const mediaType = message?.media?.type
  if (!mediaType) return 'Original message unavailable'
  return mediaType.replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase())
}

export function MessageMetadata({
  message,
  telegram,
}: {
  message: Message
  telegram: TelefastClient | null
}) {
  const reply = message.replyToMessage
  const canFetchReply = reply?.id != null
  const forward = message.forward
  const forwardChat = forward?.fromChat() ?? (forward?.sender.type === 'chat' ? forward.sender : null)
  const forwardMessageId = forward?.fromMessageId ?? forward?.raw.channelPost ?? null
  const forwardHref = forwardChat && forwardMessageId
    ? `/chat/${String(forwardChat.id)}?message=${forwardMessageId}`
    : null
  const repliedMessage = useQuery({
    queryKey: ['telegram', 'message-reply', String(message.chat.id), message.id, reply?.id],
    queryFn: () => telegram!.getReplyTo(message),
    enabled: Boolean(telegram && canFetchReply),
    staleTime: Infinity,
    retry: false,
  })

  if (!forward && !reply) return null

  const replySender = repliedMessage.data?.sender.displayName ?? reply?.sender?.displayName ?? 'Reply'
  const replyText = canFetchReply && repliedMessage.isPending
    ? 'Loading message…'
    : messagePreview(repliedMessage.data, reply?.quoteText)

  return (
    <div class="mb-2 flex flex-col gap-1.5 pr-6">
      {forward && (forwardHref ? (
        <a
          href={forwardHref}
          class="truncate text-xs font-medium text-primary underline-offset-2 hover:underline"
          title="Go to original message"
        >
          <span aria-hidden="true">↪ </span>
          Forwarded from {forward.sender.displayName}
          {forward.signature ? ` (${forward.signature})` : ''}
        </a>
      ) : (
        <p class="truncate text-xs font-medium text-primary">
          <span aria-hidden="true">↪ </span>
          Forwarded from {forward.sender.displayName}
          {forward.signature ? ` (${forward.signature})` : ''}
        </p>
      ))}
      {reply && (
        <div class="min-w-0 rounded-r-md border-l-2 border-primary bg-base-300 px-2 py-1">
          <p class="truncate text-xs font-medium text-primary">{replySender}</p>
          <p class="truncate text-xs text-muted">{replyText}</p>
        </div>
      )}
    </div>
  )
}
