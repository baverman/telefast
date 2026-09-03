import { describe, expect, it } from 'vitest'
import '../public/media-range.js'

const parseRange = globalThis.telefastParseMediaRange

describe('parseMediaRange', () => {
  it('returns the complete file when the Range header is absent', () => {
    expect(parseRange(null, 1000)).toEqual({ start: 0, end: 999, partial: false })
  })

  it('supports a complete response with unknown size', () => {
    expect(parseRange(null, undefined)).toEqual({ start: 0, end: undefined, partial: false })
  })

  it('parses a closed range', () => {
    expect(parseRange('bytes=100-199', 1000)).toEqual({ start: 100, end: 199, partial: true })
  })

  it('parses an open-ended range', () => {
    expect(parseRange('bytes=100-', 1000)).toEqual({ start: 100, end: 999, partial: true })
  })

  it('parses a suffix range', () => {
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999, partial: true })
  })

  it('clamps a suffix larger than the file', () => {
    expect(parseRange('bytes=-2000', 1000)).toEqual({ start: 0, end: 999, partial: true })
  })

  it('clamps an explicit end beyond the file', () => {
    expect(parseRange('bytes=900-1200', 1000)).toEqual({ start: 900, end: 999, partial: true })
  })

  it.each([
    ['bytes=100-199,300-399', 1000],
    ['items=100-199', 1000],
    ['bytes=-0', 1000],
    ['bytes=1000-', 1000],
    ['bytes=500-499', 1000],
    ['bytes=100-', undefined],
  ])('rejects invalid or unsupported range %s', (header, size) => {
    expect(parseRange(header, size)).toBeNull()
  })
})
