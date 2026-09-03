import type { FileLocation } from '@mtcute/web'
import type { TelefastClient } from '../telegram'

const MEDIA_PATH = '/__telefast_media__/'
const MEDIA_WORKER_VERSION = 7 // Increment for each media Service Worker update.
const DOWNLOAD_ALIGNMENT = 1024 * 1024
const DOWNLOAD_PART_SIZE_KB = 512
const STREAM_BUFFER_SIZE = 2 * 1024 * 1024

interface MediaSource {
  source: FileLocation
  size?: number
}

interface MediaRequest {
  type: 'telefast-media-request'
  requestId: string
  id: string
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

const sources = new Map<string, MediaSource>()
let client: TelefastClient | null = null
let initialized = false

export function setMediaStreamClient(nextClient: TelefastClient | null) {
  client = nextClient
}

export function streamedMediaUrl(
  id: string,
  source: FileLocation,
  mimeType: string,
  fileName?: string | null,
) {
  sources.set(id, { source, size: source.fileSize })
  const query = new URLSearchParams({ mime: mimeType })
  if (source.fileSize != null) query.set('size', String(source.fileSize))
  if (fileName) query.set('name', fileName)
  return `${MEDIA_PATH}${encodeURIComponent(id)}?${query}`
}

async function serveMedia(request: MediaRequest, port: MessagePort) {
  const media = sources.get(request.id)
  const telegram = client
  const requestedLength = request.end == null ? undefined : request.end - request.start + 1
  let readLength = 0
  let sentLength = 0
  let finished = false
  const finish = (status: 'source-complete' | 'source-cancel' | 'source-error', error?: unknown) => {
    if (finished) return
    finished = true
    if (status !== 'source-error') return
    console.error(`[Telefast media:${request.requestId}] ${status}`, {
      id: request.id,
      read: readLength,
      sent: sentLength,
      expected: requestedLength,
      ...(error == null ? {} : { error }),
    })
  }

  if (!media || !telegram) {
    const error = 'Telegram media is not available'
    finish('source-error', error)
    port.postMessage({ type: 'error', message: error })
    port.close()
    return
  }

  const alignedStart = Math.floor(request.start / DOWNLOAD_ALIGNMENT) * DOWNLOAD_ALIGNMENT
  const skipBytes = request.start - alignedStart
  const stream = telegram.downloadAsStream(media.source, {
    fileSize: media.size,
    partSize: DOWNLOAD_PART_SIZE_KB,
    offset: alignedStart,
    highWaterMark: STREAM_BUFFER_SIZE,
  })
  const reader = stream.getReader()
  let skip = skipBytes
  let remaining = requestedLength ?? Infinity
  let reading = false
  let cancelled = false

  port.addEventListener('message', (event) => {
    if (event.data?.type === 'cancel') {
      cancelled = true
      finish('source-cancel')
      void reader.cancel().finally(() => port.close())
      return
    }
    if (event.data?.type !== 'pull' || reading) return

    reading = true
    void (async () => {
      try {
        while (remaining > 0) {
          const result = await reader.read()
          if (result.done) {
            if (cancelled) return
            if (Number.isFinite(remaining)) {
              throw new Error(`Telegram media ended after ${sentLength} of ${requestedLength} bytes`)
            }
            finish('source-complete')
            port.postMessage({ type: 'done' })
            port.close()
            return
          }

          readLength += result.value.byteLength
          let chunk = result.value
          if (skip >= chunk.byteLength) {
            skip -= chunk.byteLength
            continue
          }
          if (skip > 0) {
            chunk = chunk.slice(skip)
            skip = 0
          }
          if (chunk.byteLength > remaining) chunk = chunk.slice(0, remaining)
          remaining -= chunk.byteLength
          sentLength += chunk.byteLength
          const payload = chunk.slice()
          port.postMessage({ type: 'chunk', chunk: payload }, [payload.buffer])
          return
        }

        await reader.cancel()
        finish('source-complete')
        port.postMessage({ type: 'done' })
        port.close()
      } catch (error) {
        if (cancelled) return
        finish('source-error', error)
        port.postMessage({
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        })
        port.close()
      } finally {
        reading = false
      }
    })()
  })
  port.start()
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
          window.clearTimeout(timeout)
          navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
          resolve()
        }
        const timeout = window.setTimeout(() => {
          navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
          resolve()
        }, 3000)
        navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
      })
    }
  } catch (error) {
    initialized = false
    console.error('[Telefast] Failed to initialize media streaming', error)
  }
}
