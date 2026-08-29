import { BaseTelegramClient, TelegramWorker } from '@mtcute/web'

interface InitMessage {
  type: 'telefast-init'
  apiId: number
  apiHash: string
}

function initialize(event: MessageEvent<InitMessage>) {
  if (event.data?.type !== 'telefast-init') return
  globalThis.removeEventListener('message', initialize)

  const { apiId, apiHash } = event.data
  if (!Number.isInteger(apiId) || !apiHash) {
    throw new Error('Missing Telegram API credentials')
  }

  const client = new BaseTelegramClient({
    apiId,
    apiHash,
    storage: 'telefast-session',
  })

  new TelegramWorker({
    client,
    onLastDisconnected: 'disconnect',
  }).mount()
}

globalThis.addEventListener('message', initialize)
