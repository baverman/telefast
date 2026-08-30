import { useEffect } from 'preact/hooks'
import { useLocation } from 'preact-iso'

export function Redirect({ to }: { to: string }) {
  const location = useLocation()
  useEffect(() => location.route(to, true), [to])
  return null
}
