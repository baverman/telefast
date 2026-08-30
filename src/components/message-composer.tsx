import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useBotCommands, useMessages, useSendText } from '../telegram/queries'
import { StickerPicker } from './sticker-picker'

export function MessageComposer({ peerId }: { peerId: string }) {
  const sendText = useSendText(peerId)
  const commandsQuery = useBotCommands(peerId)
  const history = useMessages(peerId)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const draft = drafts[peerId] ?? ''
  const setDraft = (value: string) => setDrafts((current) => ({ ...current, [peerId]: value }))
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
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

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    if (!draft.trim()) return
    const text = draft.trim()
    setDraft('')
    try {
      await sendText.mutateAsync(text)
    } catch {
      setDraft(text)
    }
  }

  return (
    <form class="relative shrink-0 border-t border-zinc-800 bg-zinc-900 p-3 md:px-6" onSubmit={submit}>
      {pickerOpen && <StickerPicker peerId={peerId} onSent={() => setPickerOpen(false)} />}
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
      <div class="mx-auto flex max-w-3xl items-end gap-2">
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
          disabled={!draft.trim() || sendText.isPending}
          type="submit"
          aria-label="Send message"
        >↑</button>
      </div>
    </form>
  )
}
