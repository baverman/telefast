import { useCallback, useEffect, useRef } from 'preact/hooks'

export function useDebouncedCallback(callback: () => void, delay: number) {
  const callbackRef = useRef(callback)
  const delayRef = useRef(delay)
  const activeRef = useRef(true)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  callbackRef.current = callback
  delayRef.current = delay

  const cancel = useCallback(() => {
    if (timeoutRef.current == null) return
    clearTimeout(timeoutRef.current)
    timeoutRef.current = null
  }, [])

  const flush = useCallback(() => {
    if (timeoutRef.current == null) return
    clearTimeout(timeoutRef.current)
    timeoutRef.current = null
    callbackRef.current()
  }, [])

  const schedule = useCallback(() => {
    if (!activeRef.current) return
    cancel()
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null
      callbackRef.current()
    }, delayRef.current)
  }, [cancel])

  useEffect(() => {
    activeRef.current = true
    return () => {
      activeRef.current = false
      flush()
    }
  }, [flush])

  return { callback: schedule, flush, cancel }
}
