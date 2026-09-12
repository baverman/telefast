import type { Dialog } from '@mtcute/web'
import type { QueryClient } from '@tanstack/preact-query'
import type { TelefastClient } from '../telegram'
import { cachedDialog, telegramKeys } from './query-data'
import { dialogId, isSupportedDialog } from './model'

export async function resolveDialog(
  client: TelefastClient,
  queryClient: QueryClient,
  peerId: string,
): Promise<Dialog> {
  const cached = cachedDialog(queryClient, peerId)
  if (cached) return cached
  const numericPeerId = Number(peerId)
  if (!Number.isSafeInteger(numericPeerId)) throw new Error('Invalid Telegram peer')
  const [dialog] = await client.getPeerDialogs([numericPeerId])
  if (!dialog || !isSupportedDialog(dialog)) throw new Error('Telegram chat not found')
  queryClient.setQueryData<Dialog[]>(telegramKeys.dialogs(), (current = []) => (
    current.some((item) => dialogId(item) === peerId) ? current : [...current, dialog]
  ))
  return dialog
}
