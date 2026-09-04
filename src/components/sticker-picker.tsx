import { useEffect, useMemo, useState } from 'preact/hooks'
import type { Sticker } from '@mtcute/web'
import { useTelegram } from '../telegram/telegram-provider'
import { useSendSticker, useStickers } from '../telegram/queries'
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

export function StickerPicker({ peerId, onSent }: { peerId: string; onSent: () => void }) {
  const { client } = useTelegram()
  const stickersQuery = useStickers()
  const sendSticker = useSendSticker(peerId)
  const stickerPacks = stickersQuery.data?.packs ?? []
  const recentStickers = stickersQuery.data?.recent ?? []
  const favoriteStickers = stickersQuery.data?.favorites ?? []
  const [tab, setTab] = useState('recent')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [large, setLarge] = useState(false)
  const [animatedStickerId, setAnimatedStickerId] = useState<string | null>(null)
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
        {stickersQuery.isPending || (debouncedSearch.trim().length >= 3 && !emojiSearchData) ? (
          <p class="grid min-h-40 place-items-center text-sm text-zinc-500">Loading stickers…</p>
        ) : stickers.length ? (
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
                disabled={sendSticker.isPending}
                title={stickerTitle(sticker.emoji, emojiKeywords)}
                onMouseEnter={() => setAnimatedStickerId(sticker.uniqueFileId)}
                onMouseLeave={() => setAnimatedStickerId(null)}
                onFocus={() => setAnimatedStickerId(sticker.uniqueFileId)}
                onBlur={() => setAnimatedStickerId(null)}
                onClick={() => sendSticker.mutate(sticker, { onSuccess: onSent })}
              >
                <StickerView sticker={sticker} telegram={client} compact animate={animatedStickerId === sticker.uniqueFileId} />
              </button>
            ))}
          </div>
        ) : (
          <p class="grid min-h-40 place-items-center text-sm text-zinc-500">No stickers found.</p>
        )}
      </div>
      </div>
    </section>
  )
}
