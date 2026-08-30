import { useMemo, useState } from 'preact/hooks'
import type { Sticker } from '@mtcute/web'
import { useTelegram } from '../telegram/telegram-provider'
import { useSendSticker, useStickers } from '../telegram/queries'
import { StickerView } from './media'

export function StickerPicker({ peerId, onSent }: { peerId: string; onSent: () => void }) {
  const { client } = useTelegram()
  const stickersQuery = useStickers()
  const sendSticker = useSendSticker(peerId)
  const stickerPacks = stickersQuery.data?.packs ?? []
  const recentStickers = stickersQuery.data?.recent ?? []
  const favoriteStickers = stickersQuery.data?.favorites ?? []
  const [tab, setTab] = useState('recent')
  const [search, setSearch] = useState('')
  const [large, setLarge] = useState(false)

  const stickers = useMemo(() => {
    const query = search.trim().toLowerCase()
    let result: Sticker[]
    if (query) {
      result = stickerPacks.flatMap((pack) => {
        const packMatches = pack.title.toLowerCase().includes(query) || pack.shortName.toLowerCase().includes(query)
        return pack.stickers
          .filter((info) => packMatches || info.emoji.includes(search.trim()))
          .map((info) => info.sticker)
      })
    } else if (tab === 'recent') {
      result = recentStickers
    } else if (tab === 'favorites') {
      result = favoriteStickers
    } else {
      result = stickerPacks.find((pack) => pack.shortName === tab)?.stickers.map((info) => info.sticker) ?? []
    }
    return [...new Map(result.map((sticker) => [sticker.uniqueFileId, sticker])).values()]
  }, [search, tab, stickerPacks, recentStickers, favoriteStickers])

  return (
    <section class="absolute bottom-full left-3 right-3 z-20 mx-auto mb-2 flex max-h-[70vh] max-w-3xl flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black/50">
      <div class="flex gap-2 border-b border-zinc-800 p-3">
        <input
          class="min-w-0 flex-1 rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none placeholder:text-zinc-600 focus:border-sky-500"
          value={search}
          onInput={(event) => setSearch(event.currentTarget.value)}
          placeholder="Search installed stickers"
          aria-label="Search installed stickers"
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
      <nav class="flex shrink-0 gap-1 overflow-x-auto border-b border-zinc-800 p-2" aria-label="Sticker packs">
        {[
          { id: 'recent', label: 'Recent' },
          { id: 'favorites', label: 'Favorites' },
          ...stickerPacks.map((pack) => ({ id: pack.shortName, label: pack.title })),
        ].map((item) => (
          <button
            key={item.id}
            class={`shrink-0 rounded-lg px-3 py-1.5 text-xs ${tab === item.id && !search ? 'bg-sky-500/20 text-sky-200' : 'text-zinc-400 hover:bg-zinc-800'}`}
            type="button"
            title={item.label}
            onClick={() => { setSearch(''); setTab(item.id) }}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div class="min-h-48 flex-1 overflow-y-auto p-3">
        {stickersQuery.isPending ? (
          <p class="grid min-h-40 place-items-center text-sm text-zinc-500">Loading stickers…</p>
        ) : stickers.length ? (
          <div
            class="grid gap-2"
            style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${large ? '8rem' : '4rem'}, 1fr))` }}
          >
            {stickers.map((sticker) => {
              const disabled = sticker.sourceType !== 'static'
              return (
                <button
                  key={sticker.uniqueFileId}
                  class="relative grid aspect-square place-items-center rounded-xl hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
                  type="button"
                  disabled={disabled || sendSticker.isPending}
                  title={disabled ? `${sticker.sourceType} stickers are not supported for sending yet` : `Send ${sticker.emoji || 'sticker'}`}
                  onClick={() => sendSticker.mutate(sticker, { onSuccess: onSent })}
                >
                  {disabled ? (
                    <>
                      <span class={large ? 'text-4xl' : 'text-2xl'}>{sticker.emoji || '◌'}</span>
                      <span class="absolute bottom-1 rounded bg-zinc-950/80 px-1 text-[9px] uppercase text-zinc-400">{sticker.sourceType}</span>
                    </>
                  ) : (
                    <StickerView sticker={sticker} telegram={client} compact largePreview={large} />
                  )}
                </button>
              )
            })}
          </div>
        ) : (
          <p class="grid min-h-40 place-items-center text-sm text-zinc-500">No stickers found.</p>
        )}
      </div>
    </section>
  )
}
