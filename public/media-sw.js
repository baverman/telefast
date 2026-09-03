/* global self, Response, MessageChannel, ReadableStream, Headers, URL, console */
const MEDIA_PATH = '/__telefast_media__/'
let nextMediaRequestId = 0

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

function describeError(error) {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack }
  return { message: String(error) }
}

async function findMediaClient(clientId) {
  const client = clientId ? await self.clients.get(clientId) : undefined
  if (client) return client
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  return windows.find((windowClient) => !new URL(windowClient.url).pathname.startsWith(MEDIA_PATH))
}

async function forwardWorkerLog(clientId, requestId, level, message, data) {
  if (level === 'error') console.error(`[Telefast media:${requestId}] ${message}`, data)
  else console.log(`[Telefast media:${requestId}] ${message}`, data)
  try {
    const target = await findMediaClient(clientId)
    target?.postMessage({ type: 'telefast-media-log', requestId, level, message, data })
  } catch (error) {
    console.error(`[Telefast media:${requestId}] log-forward-error`, describeError(error))
  }
}

self.addEventListener('error', (event) => {
  void forwardWorkerLog(undefined, 'worker', 'error', 'worker-error', describeError(event.error ?? event.message))
})

self.addEventListener('unhandledrejection', (event) => {
  void forwardWorkerLog(undefined, 'worker', 'error', 'worker-unhandled-rejection', describeError(event.reason))
})

function parseRange(header, size) {
  if (!header) return { start: 0, end: size == null ? undefined : size - 1, partial: false }
  const match = /^bytes=(\d*)-(\d*)$/.exec(header)
  if (!match || size == null) return null

  let start
  let end
  if (!match[1]) {
    const suffix = Number(match[2])
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] ? Number(match[2]) : size - 1
  }

  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return null
  return { start, end: Math.min(end, size - 1), partial: true }
}

async function mediaResponse(request, url, clientId, requestId, fetchEvent, settleLifetime) {
  const sizeParam = url.searchParams.get('size')
  const sizeValue = sizeParam == null ? NaN : Number(sizeParam)
  const size = Number.isSafeInteger(sizeValue) && sizeValue >= 0 ? sizeValue : undefined
  const rangeHeader = request.headers.get('range')
  const range = parseRange(rangeHeader, size)
  if (!range) {
    const data = { range: rangeHeader, expected: size, status: 416 }
    await forwardWorkerLog(clientId, requestId, 'error', 'response-error', data)
    settleLifetime()
    return new Response(null, {
      status: 416,
      headers: size == null ? undefined : { 'Content-Range': `bytes */${size}` },
    })
  }

  const target = await findMediaClient(clientId)
  if (!target) {
    const data = { error: 'Telefast page is not available' }
    await forwardWorkerLog(clientId, requestId, 'error', 'response-error', data)
    settleLifetime()
    return new Response('Telefast page is not available', { status: 503 })
  }

  const id = decodeURIComponent(url.pathname.slice(MEDIA_PATH.length))
  const channel = new MessageChannel()
  const expectedLength = size == null ? undefined : (range.end ?? size - 1) - range.start + 1
  let receivedLength = 0
  let finished = false
  const report = (level, message, data) => {
    if (level === 'error') console.error(`[Telefast media:${requestId}] ${message}`, data)
    else console.log(`[Telefast media:${requestId}] ${message}`, data)
    try {
      target.postMessage({ type: 'telefast-media-log', requestId, level, message, data })
    } catch (error) {
      console.error(`[Telefast media:${requestId}] log-forward-error`, describeError(error))
    }
  }
  const finish = (status, details = {}) => {
    if (finished) return
    finished = true
    if (status === 'response-error') {
      report('error', status, { id, received: receivedLength, expected: expectedLength, ...details })
    }
    settleLifetime()
  }
  const fail = (controller, error, phase) => {
    const details = describeError(error)
    finish('response-error', { phase, ...details })
    try {
      controller.error(error)
    } catch (controllerError) {
      report('error', 'response-controller-error', { phase, ...describeError(controllerError) })
    }
  }


  const body = new ReadableStream({
    pull(controller) {
      let resolveWork = () => {}
      const chunkWork = new Promise((resolve) => { resolveWork = resolve })

      channel.port1.onmessage = (messageEvent) => {
        try {
          if (messageEvent.data?.type === 'chunk') {
            const chunk = messageEvent.data.chunk
            if (!(chunk instanceof Uint8Array)) {
              throw new Error('Telegram media returned an invalid chunk')
            }
            if (expectedLength != null && receivedLength + chunk.byteLength > expectedLength) {
              throw new Error(`Telegram media exceeded ${expectedLength} bytes`)
            }
            receivedLength += chunk.byteLength
            controller.enqueue(chunk)
          } else if (messageEvent.data?.type === 'done') {
            if (expectedLength != null && receivedLength !== expectedLength) {
              throw new Error(`Telegram media ended after ${receivedLength} of ${expectedLength} bytes`)
            }
            finish('response-complete')
            controller.close()
          } else {
            throw new Error(messageEvent.data?.message || 'Telegram media download failed')
          }
        } catch (error) {
          fail(controller, error, 'port-message')
        } finally {
          resolveWork()
        }
      }
      channel.port1.onmessageerror = () => {
        fail(controller, new Error('Telegram media MessagePort could not deserialize a message'), 'port-message-error')
        resolveWork()
      }

      try {
        channel.port1.postMessage({ type: 'pull' })
      } catch (error) {
        fail(controller, error, 'pull-post-message')
        resolveWork()
      }

      try {
        fetchEvent.waitUntil(chunkWork)
      } catch (error) {
        report('error', 'response-wait-until-error', { id, ...describeError(error) })
      }
      return chunkWork
    },
    cancel(reason) {
      finish('response-cancel', { reason: reason == null ? undefined : String(reason) })
      try {
        channel.port1.postMessage({ type: 'cancel' })
      } catch (error) {
        report('error', 'response-cancel-message-error', { id, ...describeError(error) })
      }
      channel.port1.close()
    },
  })

  try {
    target.postMessage({
      type: 'telefast-media-request',
      requestId,
      id,
      start: range.start,
      end: range.end,
    }, [channel.port2])
  } catch (error) {
    finish('response-error', { phase: 'request-post-message', ...describeError(error) })
    channel.port1.close()
    throw error
  }

  const mimeType = url.searchParams.get('mime') || 'application/octet-stream'
  const headers = new Headers({
    'Content-Type': mimeType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
  })
  if (expectedLength != null) {
    headers.set('Content-Length', String(expectedLength))
    if (range.partial) headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
  }

  return new Response(body, { status: range.partial ? 206 : 200, headers })
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin || !url.pathname.startsWith(MEDIA_PATH)) return

  const requestId = String(++nextMediaRequestId)
  let settleLifetime = () => {}
  const lifetime = new Promise((resolve) => { settleLifetime = resolve })
  event.waitUntil(lifetime)
  event.respondWith(mediaResponse(
    event.request,
    url,
    event.clientId,
    requestId,
    event,
    settleLifetime,
  ).catch(async (error) => {
    settleLifetime()
    await forwardWorkerLog(event.clientId, requestId, 'error', 'response-setup-error', describeError(error))
    return new Response('Telegram media request failed', { status: 500 })
  }))
})
