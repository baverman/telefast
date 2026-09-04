import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { Message } from '@mtcute/web'
import { useBotCommands, useEditMessage, useMessages, useSendText, type MessageReplyTarget } from '../telegram/queries'
import { StickerPicker } from './sticker-picker'

export function MessageComposer({
  peerId,
  threadId,
  reply,
  edit,
  onReplyChange,
  onEditChange,
}: {
  peerId: string
  threadId?: number
  reply: MessageReplyTarget | null
  edit: Message | null
  onReplyChange: (reply: MessageReplyTarget | null) => void
  onEditChange: (message: Message | null) => void
}) {
  const sendText = useSendText(peerId, threadId)
  const editMessage = useEditMessage(peerId, threadId)
  const commandsQuery = useBotCommands(peerId)
  const history = useMessages(peerId, threadId)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const draft = drafts[peerId] ?? ''
  const setDraft = (value: string) => setDrafts((current) => ({ ...current, [peerId]: value }))
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const editDraftRef = useRef('')
  const editingIdRef = useRef<number | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [hiddenQuery, setHiddenQuery] = useState<string | null>(null)

  useEffect(() => {
    setPickerOpen(false)
    setActiveIndex(0)
    setHiddenQuery(null)
  }, [peerId])
  useEffect(() => {
    inputRef.current?.focus()
  }, [peerId])

  useEffect(() => {
    if (reply) inputRef.current?.focus()
  }, [reply])

  useEffect(() => {
    if (edit) {
      if (editingIdRef.current == null) editDraftRef.current = draft
      editingIdRef.current = edit.id
      setDraft(edit.text)
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    } else if (editingIdRef.current != null) {
      editingIdRef.current = null
      setDraft(editDraftRef.current)
    }
  }, [edit])
  useEffect(() => {
    if (!pickerOpen) return
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPickerOpen(false)
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [pickerOpen])

  const commands = useMemo(() => {
    const map = new Map<string, { name: string; description: string }>()
    for (const message of history.messages) {
      for (const entity of message.entities) {
        if (entity.is('bot_command') && !map.has(entity.text)) {
          map.set(entity.text, { name: entity.text, description: '' })
        }
      }
    }
    for (const command of commandsQuery.data ?? []) {
      const name = `/${command.name}`
      map.set(name, { name, description: command.description })
    }
    return [...map.values()].sort((left, right) => left.name.localeCompare(right.name))
  }, [commandsQuery.data, history.messages])

  const input = draft.trimStart()
  const showMenu = input.startsWith('/') && hiddenQuery !== input
  const query = input.slice(1).toLowerCase()
  const matches = useMemo(
    () => showMenu ? commands.filter((command) => command.name.toLowerCase().startsWith(`/${query}`)).slice(0, 8) : [],
    [commands, query, showMenu],
  )
  const active = Math.min(activeIndex, matches.length - 1)

  function applyCommand(command: { name: string }) {
    setDraft(`${command.name} `)
    setHiddenQuery(`${command.name} `)
    setActiveIndex(0)
  }

  function cancelEdit() {
    editingIdRef.current = null
    setDraft(editDraftRef.current)
    onEditChange(null)
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    if (!draft.trim()) return
    const text = draft.trim()
    setDraft('')
    try {
      if (edit) {
        await editMessage.mutateAsync({ message: edit, text })
        editingIdRef.current = null
        setDraft(editDraftRef.current)
        onEditChange(null)
      } else {
        await sendText.mutateAsync({ text, reply: reply ?? undefined })
        onReplyChange(null)
      }
    } catch {
      setDraft(text)
    }
  }

  return (
    <form class="relative shrink-0 border-t border-zinc-800 bg-zinc-900 p-3 md:px-6" onSubmit={submit}>
      {pickerOpen && <StickerPicker peerId={peerId} onSent={() => setPickerOpen(false)} />}
      {(edit || reply) && (
        <div class="mx-auto mb-2 flex max-w-3xl items-center gap-3 rounded-xl border-l-2 border-sky-400 bg-zinc-800 px-3 py-2">
          <div class="min-w-0 flex-1">
            <p class="truncate text-xs font-medium text-sky-300">
              {edit ? 'Edit message' : reply?.quote ? 'Reply to selection' : `Reply to ${reply?.message.sender.displayName}`}
            </p>
            <p class="truncate text-xs text-zinc-400">
              {edit?.text || reply?.quote?.text || reply?.message.text || 'Attachment'}
            </p>
          </div>
          <button
            type="button"
            class="icon-button size-7"
            onClick={edit ? cancelEdit : () => onReplyChange(null)}
            aria-label={edit ? 'Cancel edit' : 'Cancel reply'}
          >×</button>
        </div>
      )}
      {showMenu && matches.length > 0 && (
        <div class="absolute bottom-full left-1/2 z-20 mb-2 w-full max-w-3xl -translate-x-1/2 px-3 md:px-6">
          <div class="flex max-h-64 flex-col overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-900 py-1 shadow-2xl shadow-black/50">
            {matches.map((command, index) => (
              <button
                key={command.name}
                type="button"
                class={`flex items-baseline gap-3 px-4 py-2 text-left ${index === active ? 'bg-zinc-800' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => applyCommand(command)}
              >
                <span class="shrink-0 font-mono text-sm text-sky-300">{command.name}</span>
                {command.description && <span class="min-w-0 flex-1 truncate text-right text-xs text-zinc-500">{command.description}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
      <div class="mx-auto flex max-w-3xl items-center gap-2">
        <button
          class={`grid size-11 shrink-0 place-items-center rounded-full border text-lg transition ${pickerOpen ? 'border-sky-500 bg-sky-500/15' : 'border-zinc-700 bg-zinc-800 hover:bg-zinc-700'}`}
          type="button"
          onClick={() => setPickerOpen((open) => !open)}
          aria-label="Open sticker picker"
          aria-expanded={pickerOpen}
        >◇</button>
        <textarea
          ref={inputRef}
          class="max-h-36 min-h-11 flex-1 resize-none rounded-2xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm outline-none placeholder:text-zinc-500 focus:border-sky-500"
          rows={1}
          value={draft}
          onInput={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp' && !draft && !reply && !edit) {
              const lastOutgoing = [...history.messages].reverse().find((message) => message.isOutgoing && Boolean(message.text))
              if (lastOutgoing) {
                event.preventDefault()
                onEditChange(lastOutgoing)
                return
              }
            }
            if (event.key === 'Escape' && edit) {
              event.preventDefault()
              cancelEdit()
              return
            }
            if (showMenu && matches.length > 0) {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActiveIndex((index) => (index + 1) % matches.length)
                return
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActiveIndex((index) => (index - 1 + matches.length) % matches.length)
                return
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                setHiddenQuery(input)
                return
              }
              if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
                event.preventDefault()
                applyCommand(matches[active])
                return
              }
            }
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }}
          placeholder="Message"
        />
        <button
          class="grid size-11 shrink-0 place-items-center rounded-full bg-sky-500 font-bold text-white transition hover:bg-sky-400 disabled:opacity-40"
          disabled={!draft.trim() || sendText.isPending || editMessage.isPending}
          type="submit"
          aria-label={edit ? 'Save edit' : 'Send message'}
        >{edit ? '✓' : '↑'}</button>
      </div>
    </form>
  )
}
