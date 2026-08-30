import { useEffect, useState } from 'preact/hooks'
import { useSendText } from '../telegram/queries'
import { StickerPicker } from './sticker-picker'

export function MessageComposer({ peerId }: { peerId: string }) {
  const sendText = useSendText(peerId)
  const [draft, setDraft] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)

  useEffect(() => setPickerOpen(false), [peerId])
  useEffect(() => {
    if (!pickerOpen) return
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPickerOpen(false)
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [pickerOpen])

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
      <div class="mx-auto flex max-w-3xl items-end gap-2">
        <button
          class={`grid size-11 shrink-0 place-items-center rounded-full border text-lg transition ${pickerOpen ? 'border-sky-500 bg-sky-500/15' : 'border-zinc-700 bg-zinc-800 hover:bg-zinc-700'}`}
          type="button"
          onClick={() => setPickerOpen((open) => !open)}
          aria-label="Open sticker picker"
          aria-expanded={pickerOpen}
        >◇</button>
        <textarea
          class="max-h-36 min-h-11 flex-1 resize-none rounded-2xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm outline-none placeholder:text-zinc-500 focus:border-sky-500"
          rows={1}
          value={draft}
          onInput={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
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
