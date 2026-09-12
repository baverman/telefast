# Persistent read state

## Goal

Remember the max read message id per chat. On chat activation, jump to the
first unread incoming message. Persist across reloads. Replace the
`dialog.unreadCount` driven jump.

## Definitions

- `chatKey` = `peerId`. Read state applies to the main view only, so no thread.
- `boundary` = `max(stored last read, dialog.lastReadIngoing)`.
- `newestIncomingId` = newest incoming message id
  (`history.messages.filter((m) => !m.isOutgoing).at(-1)?.id`).
- `lastMaxRead` = max incoming id written to storage for this chat. Component
  ref.
- `lastMarkedRead` = last incoming id reported to the server with `markRead`.
  Component ref.
- Scope: `threadId == null && !pinned && searchQuery == null && targetMessageId == null`.
  Other views skip read state.

## Activation model

`MessageList` remounts per view. The keyed route wrappers in
`src/components/chat-layout.tsx` already do this. This plan relies on that and
adds no guard.

## Storage

New module `src/telegram/read-state.ts`. Stateless over `localStorage`. No
in-memory cache. No `storage` events.

- Key: `telefast.read.<accountId>`.
- Value: `{ v: 1, chats: Record<string, number> }`.
- API:
  - `getLastRead(accountId, chatKey): number | undefined`
  - `setLastRead(accountId, chatKey, id): void` — parse, store
    `max(existing, id)`, write.
  - `forgetLastRead(accountId, chatKey): void` — parse, delete the key, write.
- Each call parses and writes. Calls are infrequent: one read per mount,
  writes debounced.
- Cross-tab is out of scope. Last write wins. Values are monotonic, so the next
  write heals a lost update.

## Provider

`src/telegram/telegram-provider.tsx`

- Add `accountId: string` to `TelegramContextValue` and to the context value
  object. Set it from `resources.accountId`. MessageList renders only when
  resources exist, so it is never null.
- Keep `markRead` as implemented: optimistic raw write, `readHistory`,
  invalidate `telegramKeys.dialogs()` and the per-peer dialog key.
- Do not add a new `markRead` call here.

## History loading

`src/telegram/queries.ts`, `src/telegram/query-data.ts`

The normal view loads a window around the boundary, not the newest page. This
removes the paging loop and the "load the whole history" risk.

- `useMessages` / `useMessageHistory` take `anchor?: number` = the boundary.
- Query key includes the anchor: `messages(peerId, threadId, anchor ?? 'latest')`.
- First page when `anchor` is set: a window around the anchor.
  - `searchMessages({ chatId, threadId, offset: anchor, addOffset: -25, limit: 50 })`.
    No date needed.
  - Fall back to `getHistory({ offset: { id: anchor, date } })` if
    `messages.search` is not supported for the peer. The date comes from
    `getMessages(anchor)`.
  - Page params: `next` = older, `previous` = newer.
- First page when `anchor` is not set: the newest page, as today.
- Enable `loadNewer` whenever `history.hasPreviousPage`. Remove the
  `targetMessageId` gate in `MessageList`.

`appendMessage` and `upsertMessage`:

- Append only when the newest page is loaded: `if (pages[0]?.previous) return current`.
- While newer pages remain, skip. No gap.
- Once the user pages to the newest, `previous` is undefined and appends work.

Edge cases:

- `anchor == 0`: no stored value and no server boundary. Use the newest page.
- `anchor` at or after the newest message: use the newest page.

## Debounce hook

New module `src/hooks/use-debounced-callback.ts`.

`useDebouncedCallback(fn, delay)` returns a stable function with `flush()` and
`cancel()` attached.

- Keep `fn` in a ref, so the fired call uses the latest closure.
- Store the timer in a ref.
- `flush()` runs the pending call now and clears the timer.
- `cancel()` clears the timer without calling.
- On unmount, flush the pending call.

`MessageList` uses one instance:

```ts
const scheduleWrite = useDebouncedCallback(() => {
  const id = lastSeenIncomingIdRef.current
  if (id > lastMaxReadRef.current) {
    setLastRead(accountId, chatKey, id)
    lastMaxReadRef.current = id
  }
}, 300)
```

The hook owns timing only. The comparison against `lastMaxReadRef` stays in the
callback.

## MessageList

`src/components/message-list.tsx`

### Per-mount state

- Compute `boundary` once per mount:
  `Math.max(getLastRead(accountId, chatKey) ?? 0, dialog.lastReadIngoing)`.
  Pass `anchor = boundary` to `useMessages`.
- Refs, not state. JSX does not read them, and updates must not re-render.
- `lastMaxReadRef = useRef(boundary)`.
- `lastMarkedReadRef = useRef(dialog.lastReadIngoing)`.
- `lastSeenIncomingIdRef = useRef(0)` — max incoming id seen this session,
  monotonic. Read by the write and by the `markRead` trigger.
- `scheduleWrite` — the `useDebouncedCallback` instance.

Do not pass an expression directly to `useRef(...)`. The argument is evaluated
on every render even though it is used once. Compute `boundary` once with
`useMemo(() => ..., [])`, then pass it to both `useMessages` and `useRef`.

### Initial scroll (`useLayoutEffect`, `!initialScroll.done`)

Order of branches:

1. `targetMessageId != null` → unchanged (center the target).
2. Read state applies:
   - `firstAfter = history.messages.find((m) => !m.isOutgoing && m.id > boundary)`
   - If `firstAfter`: `scrollIntoView({ block: 'start' })`, else
     `container.scrollTop = container.scrollHeight`.
   - `done = true`, `updateNearBottom(container)`, return.
3. Not read state → unchanged bottom scroll.

No paging loop. The first page is the window around the boundary.

This replaces the current `initialScroll.hasUnread` and `dialog.unreadCount`
condition.

### Visibility tracking

Reuse `useVisible` from `src/components/media.tsx`, with an optional callback.

- Extend `useVisible(ref, rootMargin, onVisible?)`:
  - `onVisible` is optional. Media callers pass nothing and keep the boolean.
  - Store `onVisible` in a ref, so the effect does not re-subscribe.
  - Call `onVisible` only on a real intersection, not in the no-host or
    no-`IntersectionObserver` fallback.
- Extract the message article into a `MessageArticle` component, because hooks
  cannot run in a `map`.
- In `MessageArticle`, use a second `useVisible(articleRef, '0px', onVisible)`:
  - Skip when `message.isOutgoing || message.isService`.
  - Otherwise call `onSeen(message.id)`.
- `onSeen` raises `lastSeenIncomingIdRef` and runs the checks, only when
  read-state scope applies and
  `document.visibilityState === 'visible' && document.hasFocus()`:
  - `lastSeenIncomingIdRef.current = Math.max(lastSeenIncomingIdRef.current, id)`
  - If `lastSeenIncomingIdRef.current > lastMaxReadRef.current`: call
    `scheduleWrite()`.
  - If `lastSeenIncomingIdRef.current >= newestIncomingId &&
    lastSeenIncomingIdRef.current > lastMarkedReadRef.current`:
    - `lastMarkedReadRef.current = lastSeenIncomingIdRef.current`
    - `lastMaxReadRef.current = lastSeenIncomingIdRef.current`
    - call `markRead(peerId)`
    - `scheduleWrite.cancel()`
    - `forgetLastRead(accountId, chatKey)`

No `data-incoming` attribute is needed. The callback closes over `message`.

Media keeps `useVisible(ref, '240px')` for preload. Read state uses `'0px'`.

Read state is monotonic, so leaving the viewport needs no handling.

`onScroll` keeps only `updateNearBottom` and `loadOlder`.

### Debounced write

- `scheduleWrite` owns the 300 ms timer.
- At fire time it reads `lastSeenIncomingIdRef.current` and
  `lastMaxReadRef.current`, so it uses the latest values, not captured ones.
- If `id > lastMaxReadRef.current`: `setLastRead(accountId, chatKey, id)`, then
  `lastMaxReadRef.current = id`.
- `lastMaxRead` advances at write time, so the re-check stays meaningful.

### Eviction

- Eviction removes the storage entry only. Keep `lastMaxReadRef.current`, so
  the scroll rule does not write it back.
- Evict at the same time as the `markRead` call.

## ChatLayout

`src/components/chat-layout.tsx`

- Remove the effect that calls `markRead` on activation (the `hasUnread` effect).
- Remove the now-unused `hasUnread` computation, `markRead`, and `dialogId` from
  the `useTelegram()` destructure.
- Remove `useDialogs()` if no longer used.

## Notes

- Message ids are monotonic per chat. Deletion gaps are harmless: the jump uses
  `id > boundary`, not an exact id.
- If the boundary is at or past the newest incoming message, the jump falls to
  the bottom.
- When the tab is hidden or unfocused, do not advance `lastRead` and do not
  call `markRead`.
- The optimistic write in `markRead` still applies.
