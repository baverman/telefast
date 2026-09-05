import type { TelefastClient } from '../telegram'
import type { BlobCache } from './blob-cache'

export async function cachedMediaUrl(
  cache: BlobCache,
  client: TelefastClient,
  key: string,
  source: Parameters<TelefastClient['downloadAsBuffer']>[0],
  mimeType: string,
) {
  let blob: Blob | undefined
  try {
    blob = await cache.get(key)
  } catch (error) {
    console.error('[Telefast] Failed to read blob cache', error)
  }

  if (!blob) {
    console.log('[Telefast] Blob cache miss:', key)
    const bytes = await client.downloadAsBuffer(source)
    blob = new Blob([Uint8Array.from(bytes)], { type: mimeType })
    try {
      await cache.put(key, blob)
    } catch (error) {
      console.error('[Telefast] Failed to write blob cache', error)
    }
  }

  return URL.createObjectURL(blob)
}
