/* global self, Response, MessageChannel, ReadableStream, Headers, URL, console, importScripts, atob */
importScripts('/media-range.js')
const parseRange = globalThis.telefastParseMediaRange

const MEDIA_PATH = '/__telefast_media__/'
let nextMediaRequestId = 0

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

function describeError(error) {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack }
  return { message: String(error) }
}

function decodeBase64Url(value) {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(base64)
  const data = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) data[index] = binary.charCodeAt(index)
  return data
}

async function findMediaClient(clientId) {
  const client = clientId ? await self.clients.get(clientId) : undefined
  if (client && !new URL(client.url).pathname.startsWith(MEDIA_PATH)) return client
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


async function mediaResponse(request, url, clientId, requestId, settleLifetime) {
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

  const location = decodeBase64Url(decodeURIComponent(url.pathname.slice(MEDIA_PATH.length)))
  const locationBytes = location.byteLength
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
      report('error', status, { locationBytes, received: receivedLength, expected: expectedLength, ...details })
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
    start(controller) {
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
            channel.port1.close()
          } else {
            throw new Error(messageEvent.data?.message || 'Telegram media download failed')
          }
        } catch (error) {
          fail(controller, error, 'port-message')
          channel.port1.close()
        }
      }
      channel.port1.onmessageerror = () => {
        fail(controller, new Error('Telegram media MessagePort could not deserialize a message'), 'port-message-error')
        channel.port1.close()
      }
      channel.port1.start()
    },
    cancel(reason) {
      finish('response-cancel', { reason: reason == null ? undefined : String(reason) })
      try {
        channel.port1.postMessage({ type: 'cancel' })
      } catch (error) {
        report('error', 'response-cancel-message-error', { locationBytes, ...describeError(error) })
      }
      channel.port1.close()
    },
  })

  try {
    target.postMessage({
      type: 'telefast-media-request',
      requestId,
      location,
      dcId: Number(url.searchParams.get('dc')) || undefined,
      fileSize: size,
      start: range.start,
      end: range.end,
    }, [location.buffer, channel.port2])
  } catch (error) {
    finish('response-error', { phase: 'request-post-message', ...describeError(error) })
    channel.port1.close()
    throw error
  }

  const mimeType = url.searchParams.get('mime') || 'application/octet-stream'
  const headers = new Headers({
    'Content-Type': mimeType,
    'Accept-Ranges': 'bytes',
    // 'Cache-Control': 'no-store',
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
    settleLifetime,
  ).catch(async (error) => {
    settleLifetime()
    await forwardWorkerLog(event.clientId, requestId, 'error', 'response-setup-error', describeError(error))
    return new Response('Telegram media request failed', { status: 500 })
  }))
})
