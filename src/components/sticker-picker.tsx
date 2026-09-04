import { useEffect, useMemo, useState } from 'preact/hooks'
import type { Sticker } from '@mtcute/web'
import { useTelegram } from '../telegram/telegram-provider'
import { useSendSticker, useSetStickerPackInstalled, useStickerSet, useStickers } from '../telegram/queries'
import { StickerView } from './media'

type EmojiSearchEntry = {
  label: string
  tags?: string[]
  unicode: string
  skins?: Array<{ unicode: string }>
}

function normalizeEmoji(value: string) {
  return value.replace(/[\uFE0E\uFE0F]/g, '')
}

function stickerTitle(emoji: string, keywords: Map<string, string>) {
  const terms = keywords.get(normalizeEmoji(emoji))
  return [emoji, terms].filter(Boolean).join(' — ') || 'Sticker'
}


export function StickerPackView({
  stickers,
  loading,
  large,
  disabled,
  emptyMessage = 'No stickers found.',
  titleForSticker = (sticker) => `${sticker.emoji ? `${sticker.emoji} ` : ''}Sticker`,
  onSelect,
}: {
  stickers: readonly Sticker[]
  loading: boolean
  large: boolean
  disabled: boolean
  emptyMessage?: string
  titleForSticker?: (sticker: Sticker) => string
  onSelect: (sticker: Sticker) => void
}) {
  const { client } = useTelegram()
  const [animatedStickerId, setAnimatedStickerId] = useState<string | null>(null)

  if (loading) return <p class="grid min-h-40 place-items-center text-sm text-zinc-500">Loading stickers…</p>
  if (!stickers.length) return <p class="grid min-h-40 place-items-center text-sm text-zinc-500">{emptyMessage}</p>

  return (
    <div
      class="grid items-center justify-center gap-2"
      style={{ gridTemplateColumns: `repeat(auto-fill, ${large ? '8rem' : '4rem'})` }}
    >
      {stickers.map((sticker) => (
        <button
          key={sticker.uniqueFileId}
          class="relative grid w-full place-items-center overflow-hidden rounded-xl hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
          style={{ aspectRatio: `${sticker.width} / ${sticker.height}` }}
          type="button"
          disabled={disabled}
          title={titleForSticker(sticker)}
          onMouseEnter={() => setAnimatedStickerId(sticker.uniqueFileId)}
          onMouseLeave={() => setAnimatedStickerId(null)}
          onFocus={() => setAnimatedStickerId(sticker.uniqueFileId)}
          onBlur={() => setAnimatedStickerId(null)}
          onClick={() => onSelect(sticker)}
        >
          <StickerView sticker={sticker} telegram={client} compact animate={animatedStickerId === sticker.uniqueFileId} />
        </button>
      ))}
    </div>
  )
}

export function StickerPicker({ peerId, onSent }: { peerId: string; onSent: () => void }) {
  const stickersQuery = useStickers()
  const sendSticker = useSendSticker(peerId)
  const setInstalled = useSetStickerPackInstalled()
  const stickerPacks = stickersQuery.data?.packs ?? []
  const recentStickers = stickersQuery.data?.recent ?? []
  const favoriteStickers = stickersQuery.data?.favorites ?? []
  const [tab, setTab] = useState('recent')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [large, setLarge] = useState(false)
  const [emojiSearchData, setEmojiSearchData] = useState<EmojiSearchEntry[] | null>(null)

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search), 250)
    return () => window.clearTimeout(timeout)
  }, [search])

  useEffect(() => {
    if (emojiSearchData) return
    let active = true
    void import('emojibase-data/en/compact.json').then(({ default: data }) => {
      if (active) setEmojiSearchData(data)
    })
    return () => { active = false }
  }, [emojiSearchData])

  const emojiKeywords = useMemo(() => {
    const keywords = new Map<string, string>()
    for (const entry of emojiSearchData ?? []) {
      const terms = [...new Set([entry.label, ...(entry.tags ?? [])])].join(', ')
      keywords.set(normalizeEmoji(entry.unicode), terms)
      for (const skin of entry.skins ?? []) keywords.set(normalizeEmoji(skin.unicode), terms)
    }
    return keywords
  }, [emojiSearchData])

  const stickers = useMemo(() => {
    const query = debouncedSearch.trim().length >= 3 ? debouncedSearch.trim().toLowerCase() : ''
    let result: Sticker[]
    if (query && emojiSearchData) {
      const matchingEmoji = new Set(emojiSearchData.flatMap((entry) => {
        const terms = `${entry.label} ${entry.tags?.join(' ') ?? ''}`.toLowerCase()
        if (!terms.includes(query) && !entry.unicode.includes(debouncedSearch.trim())) return []
        return [entry.unicode, ...(entry.skins?.map((skin) => skin.unicode) ?? [])].map(normalizeEmoji)
      }))
      result = stickerPacks.flatMap((pack) => pack.stickers
        .filter((info) => [...matchingEmoji].some((emoji) => normalizeEmoji(info.emoji).includes(emoji)))
        .map((info) => info.sticker))
    } else if (query) {
      result = []
    } else if (tab === 'recent') {
      result = recentStickers
    } else if (tab === 'favorites') {
      result = favoriteStickers
    } else {
      result = stickerPacks.find((pack) => pack.shortName === tab)?.stickers.map((info) => info.sticker) ?? []
    }
    return [...new Map(result.map((sticker) => [sticker.uniqueFileId, sticker])).values()]
  }, [debouncedSearch, tab, stickerPacks, recentStickers, favoriteStickers, emojiSearchData])
  const selectedPack = debouncedSearch.trim().length < 3
    ? stickerPacks.find((pack) => pack.shortName === tab)
    : undefined

  return (
    <section class="absolute bottom-full left-3 right-3 z-20 mx-auto mb-2 flex max-h-[70vh] max-w-3xl flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black/50">
      <div class="flex gap-2 border-b border-zinc-800 p-3">
        <input
          class="min-w-0 flex-1 rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none placeholder:text-zinc-600 focus:border-sky-500"
          value={search}
          minLength={3}
          onInput={(event) => setSearch(event.currentTarget.value)}
          placeholder="Search stickers"
          aria-label="Search stickers"
        />
        {selectedPack && (
          <button
            class="shrink-0 rounded-xl border border-red-900/60 bg-red-900/30 px-3 text-xs font-semibold text-red-200 transition hover:bg-red-900/50 disabled:cursor-not-allowed disabled:opacity-40"
            type="button"
            disabled={setInstalled.isPending}
            onClick={() => setInstalled.mutate(
              { pack: selectedPack, installed: false },
              { onSuccess: () => setTab('recent') },
            )}
          >
            {setInstalled.isPending ? 'Removing…' : 'Remove pack'}
          </button>
        )}
        <button
          class={`shrink-0 rounded-xl border px-3 text-xs font-semibold transition ${large ? 'border-sky-500 bg-sky-500/20 text-sky-200' : 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`}
          type="button"
          title="Show sticker previews two times larger"
          aria-label="Show sticker previews two times larger"
          aria-pressed={large}
          onClick={() => setLarge((current) => !current)}
        >
          2×
        </button>
      </div>
      <div class="flex min-h-0 flex-1">
        <nav class="flex w-44 shrink-0 flex-col gap-1 overflow-y-auto border-r border-zinc-800 p-2" aria-label="Sticker packs">
          {[
            { id: 'recent', label: 'Recent' },
            { id: 'favorites', label: 'Favorites' },
            ...stickerPacks.map((pack) => ({ id: pack.shortName, label: pack.title })),
          ].map((item) => (
            <button
              key={item.id}
              class={`w-full shrink-0 truncate rounded-lg px-3 py-2 text-left text-xs transition ${tab === item.id && debouncedSearch.trim().length < 3 ? 'bg-sky-500/20 text-sky-200' : 'text-zinc-400 hover:bg-zinc-800'}`}
              type="button"
              title={item.label}
              onClick={() => { setSearch(''); setDebouncedSearch(''); setTab(item.id) }}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div class="min-h-48 min-w-0 flex-1 overflow-y-auto p-3">
        <StickerPackView
          stickers={stickers}
          loading={stickersQuery.isPending || (debouncedSearch.trim().length >= 3 && !emojiSearchData)}
          large={large}
          disabled={sendSticker.isPending}
          titleForSticker={(sticker) => stickerTitle(sticker.emoji, emojiKeywords)}
          onSelect={(sticker) => sendSticker.mutate(sticker, { onSuccess: onSent })}
        />
      </div>
      </div>
    </section>
  )
}


export function MessageStickerPackViewer({
  sticker,
  peerId,
  onSent,
  onClose,
}: {
  sticker: Sticker
  peerId: string
  onSent: () => void
  onClose: () => void
}) {
  const packQuery = useStickerSet(sticker)
  const stickersQuery = useStickers()
  const sendSticker = useSendSticker(peerId)
  const setInstalled = useSetStickerPackInstalled()
  const [large, setLarge] = useState(false)
  const pack = packQuery.data
  const installed = stickersQuery.data
    ? stickersQuery.data.packs.some((item) => item.shortName === pack?.shortName)
    : Boolean(pack?.installedDate)
  const error = packQuery.error ?? sendSticker.error ?? setInstalled.error

  return (
    <section class="fixed left-1/2 top-1/2 z-50 flex max-h-[80vh] w-[min(42rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black/60">
      <header class="flex items-center gap-3 border-b border-zinc-800 p-3">
        <div class="min-w-0 flex-1">
          <h2 class="truncate font-medium">{pack?.title ?? 'Sticker pack'}</h2>
          {pack && <p class="text-xs text-zinc-500">{pack.count} stickers</p>}
        </div>
        <button
          class={`shrink-0 rounded-xl border px-3 py-2 text-xs font-semibold transition ${large ? 'border-sky-500 bg-sky-500/20 text-sky-200' : 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`}
          type="button"
          title="Show sticker previews two times larger"
          aria-label="Show sticker previews two times larger"
          aria-pressed={large}
          onClick={() => setLarge((current) => !current)}
        >2×</button>
        <button type="button" class="icon-button size-8" onClick={onClose} aria-label="Close">×</button>
      </header>
      <div class="min-h-48 flex-1 overflow-y-auto p-3">
        <StickerPackView
          stickers={pack?.stickers.map((info) => info.sticker) ?? []}
          loading={packQuery.isPending}
          large={large}
          disabled={sendSticker.isPending}
          emptyMessage={packQuery.isError ? 'Failed to load sticker pack.' : 'This sticker pack is empty.'}
          onSelect={(selected) => sendSticker.mutate(selected, { onSuccess: onSent })}
        />
      </div>
      {(error || (pack && !installed)) && (
        <footer class="border-t border-zinc-800 p-3">
          {error && <p role="alert" class={`${pack && !installed ? 'mb-2 ' : ''}text-xs text-red-300`}>{error.message}</p>}
          {pack && !installed && (
            <button
              type="button"
              class="w-full rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={setInstalled.isPending}
              onClick={() => setInstalled.mutate({ pack, installed: true })}
            >
              {setInstalled.isPending ? 'Adding…' : 'Add sticker pack'}
            </button>
          )}
        </footer>
      )}
    </section>
  )
}
