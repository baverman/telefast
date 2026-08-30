import type { TelefastClient } from '../telegram'

const objectUrls = new Map<string, string>()
const pending = new Map<string, Promise<string>>()

export function cachedMediaUrl(
  client: TelefastClient,
  key: string,
  source: Parameters<TelefastClient['downloadAsBuffer']>[0],
  mimeType: string,
) {
  const cached = objectUrls.get(key)
  if (cached) return Promise.resolve(cached)
  const existing = pending.get(key)
  if (existing) return existing

  const request = client.downloadAsBuffer(source)
    .then((bytes) => {
      const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: mimeType }))
      objectUrls.set(key, url)
      pending.delete(key)
      return url
    })
    .catch((error) => {
      pending.delete(key)
      throw error
    })
  pending.set(key, request)
  return request
}

export function clearMediaCache() {
  objectUrls.forEach((url) => URL.revokeObjectURL(url))
  objectUrls.clear()
  pending.clear()
}
