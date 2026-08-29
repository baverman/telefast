import { TelegramClient, TelegramWorkerPort } from '@mtcute/web'

export function createTelegramConnection(apiId: number, apiHash: string) {
  const worker = new Worker(new URL('./telegram.worker.ts', import.meta.url), {
    type: 'module',
    name: 'telefast-mtcute',
  })
  worker.postMessage({ type: 'telefast-init', apiId, apiHash })

  const port = new TelegramWorkerPort({ worker })
  const client = new TelegramClient({
    client: port,
  })

  return {
    client,
    destroy: () => port.destroy(true),
  }
}

export type TelefastClient = ReturnType<typeof createTelegramConnection>['client']
