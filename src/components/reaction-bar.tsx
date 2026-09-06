import { useEffect, useState } from 'preact/hooks'
import type { Message } from '@mtcute/web'
import { useDeleteMessage, useDialogs, useForwardMessage, useSendReaction, useSetMessagePinned, type MessageReplyTarget } from '../telegram/queries'
import { canSendMessages } from '../telegram/model'
import { MessageStickerPackViewer } from './sticker-picker'

const QUICK_REACTIONS = ['👍', '❤️', '😂', '🔥', '🎉', '😢']

export function ReactionBar({ message, peerId, threadId }: { message: Message; peerId: string; threadId?: number }) {
  const react = useSendReaction(peerId, threadId)
  const reactions = (message.reactions?.reactions ?? [])
    .filter((reaction) => typeof reaction.emoji === 'string')

  if (!reactions.length) return null

  return (
    <>
      {reactions.map((reaction) => {
        const emoji = reaction.emoji as string
        const active = reaction.order !== null
        return (
          <button
            key={emoji}
            type="button"
            class={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
              active
                ? 'border-primary bg-primary/15 text-primary'
                : 'border-base-300 bg-base-100 text-base-content'
            }`}
            onClick={() => react.mutate({ messageId: message.id, emoji, remove: active })}
            title={active ? 'Remove reaction' : `React with ${emoji}`}
          >
            <span>{emoji}</span>
            <span class="tabular-nums">{reaction.count}</span>
          </button>
        )
      })}
    </>
  )
}

export function MessageContextMenu({
         message,
         peerId,
         threadId,
         quote,
         x,
         y,
         placement,
         pinnedView = false,
         filteredView = false,
         canPinMessages = false,
         onJump,
         onReply,
         onEdit,
         onClose,
       }: {
         message: Message
         peerId: string
         threadId?: number
         quote?: MessageReplyTarget['quote']
         x: number
         y: number
         placement: 'above' | 'below'
         pinnedView?: boolean
         filteredView?: boolean
         canPinMessages?: boolean
         onJump?: () => void
         onReply: (reply: MessageReplyTarget) => void
         onEdit: (message: Message) => void
         onClose: () => void
       }) {
         const [view, setView] = useState<'menu' | 'sticker-pack' | 'forward' | 'delete'>('menu')
         const react = useSendReaction(peerId, threadId)
         const remove = useDeleteMessage(peerId, threadId)
         const setPinned = useSetMessagePinned(peerId, threadId)
         const forward = useForwardMessage()
         const dialogs = useDialogs()
         const reactions = message.reactions?.reactions ?? []
         const sticker = message.media?.type === 'sticker' ? message.media : null
         const isPinned = pinnedView || message.isPinned
         const isActive = (emoji: string) => reactions.some((reaction) => reaction.emoji === emoji && reaction.order !== null)
         const error = remove.error ?? forward.error ?? setPinned.error

         useEffect(() => {
           function onKeyDown(event: KeyboardEvent) {
             if (event.key === 'Escape') onClose()
           }
           window.addEventListener('keydown', onKeyDown)
           return () => window.removeEventListener('keydown', onKeyDown)
         }, [onClose])

         const action = (label: string, handler: () => void, disabled = false, danger = false) => (
           <button
             type="button"
             role="menuitem"
             class={`w-full rounded-lg px-3 py-2 text-left text-sm transition disabled:opacity-40 ${danger ? 'text-error' : 'text-base-content'}`}
             disabled={disabled}
             onClick={handler}
           >
             {label}
           </button>
         )

         return (
           <>
             <div class="fixed inset-0 z-40 bg-black/10" onMouseDown={onClose} />
             {view === 'menu' ? (
               <div
                 class={`fixed z-50 w-60 -translate-x-1/2 rounded-xl border border-base-300 bg-base-100 p-1.5 shadow-2xl shadow-black/50 ${placement === 'above' ? '-translate-y-full' : ''}`}
                 style={{ left: `${x}px`, top: `${y}px` }}
                 role="menu"
               >
                 <div class="mb-1 flex justify-between gap-1 border-b border-base-300 pb-1.5">
                   {QUICK_REACTIONS.map((emoji) => {
                     const active = isActive(emoji)
                     return (
                       <button
                         key={emoji}
                         type="button"
                         class={`grid size-8 place-items-center rounded-full text-base transition ${active ? 'bg-primary/15' : ''}`}
                         role="menuitem"
                         title={active ? `Remove ${emoji}` : `React with ${emoji}`}
                         onClick={() => {
                           react.mutate({ messageId: message.id, emoji, remove: active })
                           onClose()
                         }}
                       >
                         {emoji}
                       </button>
                     )
                   })}
                 </div>
                 {onJump && action('Jump to', () => { onJump(); onClose() })}
                 {!filteredView && action('Reply', () => { onReply({ message, quote }); onClose() })}
                 {!filteredView && message.isOutgoing && message.text && action('Edit', () => { onEdit(message); onClose() })}
                 {canPinMessages && action(isPinned ? 'Unpin' : 'Pin', () => {
                   void setPinned.mutateAsync({ message, pinned: !isPinned }).then(onClose).catch(() => undefined)
                 }, setPinned.isPending)}
                 {sticker?.hasStickerSet && action('View sticker pack', () => setView('sticker-pack'))}
                 {action('Forward…', () => setView('forward'), !message.canBeForwarded)}
                 {action('Delete…', () => setView('delete'), false, true)}
               </div>
             ) : view === 'sticker-pack' && sticker ? (
               <MessageStickerPackViewer
                 sticker={sticker}
                 peerId={peerId}
                 onSent={onClose}
                 onClose={onClose}
               />
             ) : (
               <div class="fixed left-1/2 top-1/2 z-50 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-base-300 bg-base-100 p-4 shadow-2xl shadow-black/60">
                 {view === 'forward' ? (
                   <>
                     <div class="mb-3 flex items-center justify-between gap-3">
                       <h2 class="font-medium">Forward message</h2>
                       <button type="button" class="icon-button size-8" onClick={onClose} aria-label="Close">×</button>
                     </div>
                     <div class="max-h-80 overflow-y-auto">
                       {(dialogs.data ?? []).filter((dialog) => canSendMessages(dialog.peer)).map((dialog) => (
                         <button
                           key={String(dialog.peer.id)}
                           type="button"
                           class="block w-full truncate rounded-lg px-3 py-2 text-left text-sm disabled:opacity-40"
                           disabled={forward.isPending}
                           onClick={() => {
                             void forward.mutateAsync({ message, toPeerId: String(dialog.peer.id) })
                               .then(onClose)
                               .catch(() => undefined)
                           }}
                         >
                           {dialog.peer.displayName}
                         </button>
                       ))}
                     </div>
                   </>
                 ) : (
                   <>
                     <h2 class="mb-2 font-medium">Delete message</h2>
                     <p class="mb-4 text-sm text-muted">Choose where this message is deleted.</p>
                     <div class="flex flex-col gap-2">
                       <button
                         type="button"
                         class="rounded-lg bg-base-300 px-4 py-2 text-sm disabled:opacity-40"
                         disabled={remove.isPending}
                         onClick={() => void remove.mutateAsync({ message, revoke: false }).then(onClose).catch(() => undefined)}
                       >Delete only for me</button>
                       <button
                         type="button"
                         class="rounded-lg bg-error px-4 py-2 text-sm text-error-content disabled:opacity-40"
                         disabled={remove.isPending}
                         onClick={() => void remove.mutateAsync({ message, revoke: true }).then(onClose).catch(() => undefined)}
                       >Delete for both parties</button>
                       <button type="button" class="rounded-lg px-4 py-2 text-sm text-muted" onClick={onClose}>Cancel</button>
                     </div>
                   </>
                 )}
                 {error && <p role="alert" class="mt-3 text-xs text-error">{error.message}</p>}
               </div>
             )}
           </>
         )
       }
