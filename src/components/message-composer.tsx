import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { Message } from '@mtcute/web'
import { useBotCommands, useEditMessage, useSendAttachments, useSendText, type MessageReplyTarget } from '../telegram/queries'
import { getChainMessages } from '../telegram/message-store'
import { messageStoreKey, useTelegram } from '../telegram/telegram-provider'
import { StickerPicker } from './sticker-picker'

interface PendingAttachment {
  id: string
  file: File
  previewUrl?: string
}

function attachmentId(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`
}

function clipboardFile(file: File) {
  if (file.name) return file
  const extension = file.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png'
  return new File([file], `clipboard-image-${Date.now()}.${extension}`, { type: file.type })
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

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
  const sendAttachments = useSendAttachments(peerId, threadId)
  const editMessage = useEditMessage(peerId, threadId)
  const commandsQuery = useBotCommands(peerId)
  const { messageStores } = useTelegram()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const draft = drafts[peerId] ?? ''
  const setDraft = (value: string) => setDrafts((current) => ({ ...current, [peerId]: value }))
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const editDraftRef = useRef('')
  const editingIdRef = useRef<number | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [hiddenQuery, setHiddenQuery] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const attachmentsRef = useRef<PendingAttachment[]>([])
  const [uploadProgress, setUploadProgress] = useState<{ file: File; uploaded: number; total: number } | null>(null)
  attachmentsRef.current = attachments

  function clearAttachments() {
    for (const attachment of attachmentsRef.current) {
      if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl)
    }
    attachmentsRef.current = []
    setAttachments([])
    setUploadProgress(null)
  }

  function addFiles(files: Iterable<File>) {
    const pending = Array.from(files).map((source) => {
      const file = clipboardFile(source)
      return {
        id: attachmentId(file),
        file,
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
      }
    })
    if (!pending.length) return
    sendAttachments.reset()
    setAttachments((current) => [...current, ...pending])
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  function removeAttachment(id: string) {
    sendAttachments.reset()
    setAttachments((current) => current.filter((attachment) => {
      if (attachment.id !== id) return true
      if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl)
      return false
    }))
  }

  useEffect(() => {
    setPickerOpen(false)
    setActiveIndex(0)
    setHiddenQuery(null)
    clearAttachments()
  }, [peerId])

  useEffect(() => () => {
    for (const attachment of attachmentsRef.current) {
      if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl)
    }
  }, [])

  useEffect(() => {
    inputRef.current?.focus()
  }, [peerId])

  useEffect(() => {
    if (reply) inputRef.current?.focus()
  }, [reply])

  useEffect(() => {
    if (edit) {
      clearAttachments()
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
    for (const command of commandsQuery.data ?? []) {
      const name = `/${command.name}`
      map.set(name, { name, description: command.description })
    }
    return [...map.values()].sort((left, right) => left.name.localeCompare(right.name))
  }, [commandsQuery.data])

  const input = draft.trimStart()
  const showMenu = input.startsWith('/') && hiddenQuery !== input
  const query = input.slice(1).toLowerCase()
  const matches = useMemo(
    () => showMenu ? commands.filter((command) => command.name.toLowerCase().startsWith(`/${query}`)).slice(0, 8) : [],
    [commands, query, showMenu],
  )
  const active = Math.min(activeIndex, matches.length - 1)
  const sending = sendText.isPending || sendAttachments.isPending || editMessage.isPending

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
    if ((!draft.trim() && attachments.length === 0) || sending) return
    const text = draft.trim()
    setDraft('')

    if (edit) {
      try {
        await editMessage.mutateAsync({ message: edit, text })
        editingIdRef.current = null
        setDraft(editDraftRef.current)
        onEditChange(null)
      } catch {
        setDraft(text)
      }
      return
    }

    if (attachments.length > 0) {
      const selected = [...attachments]
      let sentCount = 0
      try {
        await sendAttachments.mutateAsync({
          files: selected.map((attachment) => attachment.file),
          caption: text,
          reply: reply ?? undefined,
          onProgress: (index, uploaded, total) => setUploadProgress({ file: selected[index].file, uploaded, total }),
          onFileSent: (file) => {
            sentCount += 1
            setAttachments((current) => current.filter((attachment) => {
              if (attachment.file !== file) return true
              if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl)
              return false
            }))
          },
        })
        onReplyChange(null)
      } catch {
        if (sentCount === 0) setDraft(text)
        else onReplyChange(null)
      } finally {
        setUploadProgress(null)
      }
      return
    }

    try {
      await sendText.mutateAsync({ text, reply: reply ?? undefined })
      onReplyChange(null)
    } catch {
      setDraft(text)
    }
  }

  const uploadError = sendAttachments.error instanceof Error
    ? sendAttachments.error.message
    : sendAttachments.isError ? 'Could not send attachment' : ''

  return (
    <form
      class="relative shrink-0 border-t border-base-300 bg-base-100 p-3 md:px-6"
      onSubmit={submit}
      onDragOver={(event) => {
        if (!edit && !sendAttachments.isPending && event.dataTransfer?.types.includes('Files')) event.preventDefault()
      }}
      onDrop={(event) => {
        if (edit || sendAttachments.isPending || !event.dataTransfer?.files.length) return
        event.preventDefault()
        addFiles(event.dataTransfer.files)
      }}
    >
      {pickerOpen && <StickerPicker peerId={peerId} onSent={() => setPickerOpen(false)} />}
      {(edit || reply) && (
        <div class="mx-auto mb-2 flex max-w-3xl items-center gap-3 rounded-xl border-l-2 border-primary bg-base-300 px-3 py-2">
          <div class="min-w-0 flex-1">
            <p class="truncate text-xs font-medium text-primary">
              {edit ? 'Edit message' : reply?.quote ? 'Reply to selection' : `Reply to ${reply?.message.sender.displayName}`}
            </p>
            <p class="truncate text-xs text-muted">
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
      {attachments.length > 0 && (
        <div class="mx-auto mb-2 max-w-3xl">
          <div class="flex gap-2 overflow-x-auto pb-1">
            {attachments.map((attachment) => (
              <div key={attachment.id} class="relative flex w-44 shrink-0 items-center gap-2 rounded-xl border border-base-300 bg-base-200 p-2 pr-8">
                {attachment.previewUrl
                  ? <img class="size-12 shrink-0 rounded-lg object-cover" src={attachment.previewUrl} alt="" />
                  : <span class="grid size-12 shrink-0 place-items-center rounded-lg bg-base-300 text-xl" aria-hidden="true">📄</span>}
                <span class="min-w-0">
                  <strong class="block truncate text-xs" title={attachment.file.name}>{attachment.file.name}</strong>
                  <span class="block text-[11px] text-muted">{formatFileSize(attachment.file.size)}</span>
                  {uploadProgress?.file === attachment.file && uploadProgress.total > 0 && (
                    <span class="mt-1 block h-1 overflow-hidden rounded-full bg-base-300">
                      <span class="block h-full bg-primary" style={{ width: `${Math.min(100, uploadProgress.uploaded / uploadProgress.total * 100)}%` }} />
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  class="absolute right-1 top-1 grid size-6 place-items-center rounded-full text-sm hover:bg-base-300 disabled:opacity-40"
                  disabled={sendAttachments.isPending}
                  onClick={() => removeAttachment(attachment.id)}
                  aria-label={`Remove ${attachment.file.name}`}
                >×</button>
              </div>
            ))}
          </div>
          {uploadError && <p class="mt-1 text-xs text-error" role="alert">{uploadError}</p>}
        </div>
      )}
      {showMenu && matches.length > 0 && (
        <div class="absolute bottom-full left-1/2 z-20 mb-2 w-full max-w-3xl -translate-x-1/2 px-3 md:px-6">
          <div class="flex max-h-64 flex-col overflow-y-auto rounded-2xl border border-base-300 bg-base-100 py-1 shadow-2xl shadow-black/50">
            {matches.map((command, index) => (
              <button
                key={command.name}
                type="button"
                class={`flex items-baseline gap-3 px-4 py-2 text-left ${index === active ? 'bg-base-300' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => applyCommand(command)}
              >
                <span class="shrink-0 font-mono text-sm text-primary">{command.name}</span>
                {command.description && <span class="min-w-0 flex-1 truncate text-right text-xs text-muted">{command.description}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
      <div class="mx-auto flex max-w-3xl items-center gap-2">
        <button
          class={`grid size-11 shrink-0 place-items-center rounded-full border text-lg transition ${pickerOpen ? 'border-primary bg-primary/15' : 'border-base-300 bg-base-100'}`}
          type="button"
          onClick={() => setPickerOpen((open) => !open)}
          aria-label="Open sticker picker"
          aria-expanded={pickerOpen}
        >◇</button>
        <button
          class="grid size-11 shrink-0 place-items-center rounded-full border border-base-300 bg-base-100 text-lg transition disabled:opacity-40"
          type="button"
          disabled={Boolean(edit) || sendAttachments.isPending}
          onClick={() => fileInputRef.current?.click()}
          aria-label="Attach files"
          title={edit ? 'Attachments cannot be added while editing' : 'Attach files'}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="m21.4 11.6-8.9 8.9a6 6 0 0 1-8.5-8.5l9.6-9.6a4 4 0 0 1 5.7 5.7l-9.6 9.6a2 2 0 0 1-2.8-2.8l8.9-8.9" />
          </svg>
        </button>
        <input
          ref={fileInputRef}
          class="hidden"
          type="file"
          multiple
          disabled={Boolean(edit) || sendAttachments.isPending}
          onChange={(event) => {
            if (event.currentTarget.files) addFiles(event.currentTarget.files)
            event.currentTarget.value = ''
          }}
        />
        <textarea
          ref={inputRef}
          class="max-h-36 min-h-11 flex-1 resize-none rounded-2xl border border-base-300 bg-base-100 text-base-content px-4 py-3 text-sm outline-none focus:border-primary"
          rows={1}
          value={draft}
          onInput={(event) => setDraft(event.currentTarget.value)}
          onPaste={(event) => {
            if (edit || sendAttachments.isPending) return
            const images = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith('image/'))
            if (!images.length) return
            event.preventDefault()
            addFiles(images)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp' && !draft && !reply && !edit && attachments.length === 0) {
              const chain = messageStores.get(messageStoreKey(peerId, threadId))?.chain()
              const messages = chain ? getChainMessages(chain.head) : []
              const lastOutgoing = [...messages].reverse().find((message) => message.isOutgoing && Boolean(message.text))
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
          placeholder={attachments.length ? 'Add a caption' : 'Message'}
        />
        <button
          class="grid size-11 shrink-0 place-items-center rounded-full bg-primary font-bold text-primary-content transition disabled:opacity-40"
          disabled={(!draft.trim() && attachments.length === 0) || sending}
          type="submit"
          aria-label={edit ? 'Save edit' : 'Send message'}
        >{edit ? '✓' : '↑'}</button>
      </div>
    </form>
  )
}
