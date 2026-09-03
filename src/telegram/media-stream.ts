import { type FileLocation, type tl } from '@mtcute/web'
import { deserializeObject, serializeObject } from '@mtcute/web/utils.js'
import type { TelefastClient } from '../telegram'

const MEDIA_PATH = '/__telefast_media__/'
const MEDIA_WORKER_VERSION = 13 // Increment for each media Service Worker update.
const DOWNLOAD_PART_SIZE_KB = 1024
const DOWNLOAD_PART_SIZE = DOWNLOAD_PART_SIZE_KB * 1024

type DownloadableMedia = FileLocation

interface MediaRequest {
  type: 'telefast-media-request'
  requestId: string
  location: Uint8Array
  dcId?: number
  fileSize?: number
  start: number
  end?: number
}

interface MediaLog {
  type: 'telefast-media-log'
  requestId: string
  level: 'log' | 'error'
  message: string
  data: unknown
}

type MediaWorkerMessage = MediaRequest | MediaLog

let client: TelefastClient | null = null
let initialized = false

export function setMediaStreamClient(nextClient: TelefastClient | null) {
  client = nextClient
}

function encodeBase64Url(data: Uint8Array) {
  let binary = ''
  for (const byte of data) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

export function streamedMediaUrl(
  source: DownloadableMedia,
  mimeType: string,
  fileName?: string | null,
) {
  const location = typeof source.location === 'function' ? source.location() : source.location
  if (ArrayBuffer.isView(location)) throw new Error('Inline media cannot be streamed')

  const serializedLocation = serializeObject(location)
  const query = new URLSearchParams({ mime: mimeType })
  if (source.fileSize != null) query.set('size', String(source.fileSize))
  if (source.dcId != null) query.set('dc', String(source.dcId))
  if (fileName) query.set('name', fileName)
  return `${MEDIA_PATH}${encodeBase64Url(serializedLocation)}?${query}`
}

async function serveMedia(request: MediaRequest, port: MessagePort) {
  const telegram = client
  const end = request.end == null ? undefined : request.end + 1
  const expectedLength = end == null ? undefined : end - request.start
  const location = deserializeObject(request.location) as tl.TypeInputFileLocation | tl.TypeInputWebFileLocation
  const abortController = new AbortController()
  const alignedStart = Math.floor(request.start / DOWNLOAD_PART_SIZE) * DOWNLOAD_PART_SIZE
  let sourceOffset = alignedStart
  let sentLength = 0
  let cancelled = false

  console.log(`[Telefast media:${request.requestId}] stream-request`, {
    start: request.start,
    end: request.end,
    endExclusive: end,
    alignedStart,
    fileSize: request.fileSize,
    expected: expectedLength,
  })

  port.addEventListener('message', (event) => {
    if (event.data?.type !== 'cancel') return
    cancelled = true
    abortController.abort()
    console.log(`[Telefast media:${request.requestId}] stream-cancel`, {
      sourceOffset,
      sent: sentLength,
      expected: expectedLength,
    })
  })
  port.start()

  if (!telegram || end == null) {
    const message = telegram ? 'Telegram media size is not available' : 'Telegram client is not available'
    port.postMessage({ type: 'error', message })
    port.close()
    return
  }

  try {
    const chunks = telegram.downloadAsIterable(location, {
      dcId: request.dcId,
      fileSize: request.fileSize,
      offset: alignedStart,
      partSize: DOWNLOAD_PART_SIZE_KB,
      abortSignal: abortController.signal,
    })

    for await (const chunk of chunks) {
      if (cancelled) break

      const chunkStart = sourceOffset
      sourceOffset += chunk.byteLength
      const trimStart = Math.max(0, request.start - chunkStart)
      const trimEnd = Math.min(chunk.byteLength, end - chunkStart)

      if (trimEnd > trimStart) {
        const payload = chunk.slice(trimStart, trimEnd)
        sentLength += payload.byteLength
        port.postMessage({ type: 'chunk', chunk: payload }, [payload.buffer])
      }


      if (sourceOffset >= end) break
    }

    if (!cancelled && sentLength !== expectedLength) {
      throw new Error(`Telegram media ended after ${sentLength} of ${expectedLength} bytes`)
    }
    if (!cancelled) {
      console.log(`[Telefast media:${request.requestId}] stream-complete`, {
        sourceOffset,
        sent: sentLength,
        expected: expectedLength,
      })
      port.postMessage({ type: 'done' })
    }
  } catch (error) {
    if (!cancelled) {
      console.error(`[Telefast media:${request.requestId}] source-error`, {
        location: location._,
        sent: sentLength,
        expected: expectedLength,
        error,
      })
      port.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  } finally {
    port.close()
  }
}

export async function initializeMediaStreaming() {
  if (initialized || !('serviceWorker' in navigator)) return
  initialized = true
  navigator.serviceWorker.addEventListener('message', (event: MessageEvent<MediaWorkerMessage>) => {
    if (event.data?.type === 'telefast-media-log') {
      if (event.data.level === 'error') {
        console.error(`[Telefast media:${event.data.requestId}] ${event.data.message}`, event.data.data)
      }
      return
    }
    if (event.data?.type !== 'telefast-media-request') return
    const port = event.ports[0]
    if (port) void serveMedia(event.data, port)
  })

  try {
    const workerUrl = `/media-sw.js?v=${MEDIA_WORKER_VERSION}`
    const expectedScriptUrl = new URL(workerUrl, window.location.href).href
    await navigator.serviceWorker.register(workerUrl, { updateViaCache: 'none' })
    await navigator.serviceWorker.ready
    if (navigator.serviceWorker.controller?.scriptURL !== expectedScriptUrl) {
      await new Promise<void>((resolve) => {
        const onControllerChange = () => {
          if (navigator.serviceWorker.controller?.scriptURL !== expectedScriptUrl) return
          navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
          resolve()
        }
        navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
        onControllerChange()
      })
    }
  } catch (error) {
    initialized = false
    console.error('[Telefast] Failed to initialize media streaming', error)
  }
}
