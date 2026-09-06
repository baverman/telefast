import type { TelefastClient } from '../telegram'
import type { FileLocation } from '@mtcute/web'
import type { BlobCache } from './blob-cache'
import { streamedMediaUrl } from './media-stream'

const BLOB_CACHE_SIZE_LIMIT = 10 * 1024 * 1024
type DownloadableMedia = Parameters<TelefastClient['downloadAsBuffer']>[0]

export function shouldUseBlobCache(fileSize: number | undefined) {
  return fileSize == null || fileSize < BLOB_CACHE_SIZE_LIMIT
}
export async function cachedMediaBlob(
  cache: BlobCache,
  client: TelefastClient,
  key: string,
  source: DownloadableMedia,
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

  return blob
}

export async function mediaUrl(
  cache: BlobCache,
  client: TelefastClient,
  key: string,
  source: FileLocation,
  mimeType: string,
  fileName?: string | null,
) {
  if (!shouldUseBlobCache(source.fileSize)) {
    return streamedMediaUrl(source, mimeType, fileName)
  }
  return URL.createObjectURL(await cachedMediaBlob(cache, client, key, source, mimeType))
}
