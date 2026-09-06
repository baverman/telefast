import { useState } from 'preact/hooks'
import { Redirect } from '../routing/redirect'
import { useTelegram } from '../telegram/telegram-provider'

export function LoginPage() {
  const {
    status, authStep, passwordHint, deliveryLabel, busy, error,
    beginLogin, submitCode, submitPassword, reconnect,
  } = useTelegram()
  const [apiId, setApiId] = useState(localStorage.getItem('telefast.apiId') ?? '')
  const [apiHash, setApiHash] = useState(localStorage.getItem('telefast.apiHash') ?? '')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [validationError, setValidationError] = useState('')

  if (status === 'authenticated') return <Redirect to="/chat" />
  if (status === 'loading') return <ConnectionScreen />
  if (status === 'disconnected') return <ConnectionScreen error={error} onRetry={() => void reconnect()} />

  function start(event: SubmitEvent) {
    event.preventDefault()
    const parsedApiId = Number(apiId)
    if (!Number.isInteger(parsedApiId) || !apiHash.trim() || !phone.trim()) {
      setValidationError('Enter a valid API ID, API hash, and phone number.')
      return
    }
    setValidationError('')
    void beginLogin({ apiId: parsedApiId, apiHash: apiHash.trim(), phone: phone.trim() })
  }

  return (
    <main class="grid min-h-screen place-items-center bg-base-200 p-5 text-base-content">
      <section class="w-full max-w-md rounded-3xl border border-base-300 bg-base-100 p-7 shadow-2xl shadow-black/40">
        <div class="mb-8">
          <div class="mb-4 grid size-12 place-items-center rounded-2xl bg-primary text-xl font-bold text-primary-content">T</div>
          <h1 class="text-2xl font-semibold tracking-tight">Telefast</h1>
          <p class="mt-2 text-sm leading-6 text-muted">A direct, lightweight Telegram client. Data stays in this browser.</p>
        </div>

        {authStep === 'credentials' && (
          <form class="space-y-4" onSubmit={start}>
            <label class="field">
              <span>API ID</span>
              <input inputMode="numeric" autocomplete="off" value={apiId} onInput={(event) => setApiId(event.currentTarget.value)} placeholder="12345678" />
            </label>
            <label class="field">
              <span>API hash</span>
              <input autocomplete="off" value={apiHash} onInput={(event) => setApiHash(event.currentTarget.value)} placeholder="From my.telegram.org" />
            </label>
            <label class="field">
              <span>Phone number</span>
              <input type="tel" autocomplete="tel" value={phone} onInput={(event) => setPhone(event.currentTarget.value)} placeholder="+1 555 000 0000" />
            </label>
            <button class="primary-button" disabled={busy} type="submit">{busy ? 'Connecting…' : 'Continue'}</button>
            <p class="text-center text-xs leading-5 text-muted">Create application credentials at my.telegram.org.</p>
          </form>
        )}

        {authStep === 'code' && (
          <form class="space-y-4" onSubmit={(event) => { event.preventDefault(); if (code.trim()) submitCode(code.trim()) }}>
            <div>
              <h2 class="font-medium">Enter the login code</h2>
              <p class="mt-1 text-sm text-muted">Sent {deliveryLabel}.</p>
            </div>
            <label class="field">
              <span>Code</span>
              <input inputMode="numeric" autocomplete="one-time-code" autofocus value={code} onInput={(event) => setCode(event.currentTarget.value)} placeholder="12345" />
            </label>
            <button class="primary-button" disabled={busy || !code.trim()} type="submit">{busy ? 'Checking…' : 'Sign in'}</button>
          </form>
        )}

        {authStep === 'password' && (
          <form class="space-y-4" onSubmit={(event) => { event.preventDefault(); if (password) submitPassword(password) }}>
            <div>
              <h2 class="font-medium">Two-step verification</h2>
              <p class="mt-1 text-sm text-muted">{passwordHint ? `Hint: ${passwordHint}` : 'Enter your Telegram password.'}</p>
            </div>
            <label class="field">
              <span>Password</span>
              <input type="password" autocomplete="current-password" autofocus value={password} onInput={(event) => setPassword(event.currentTarget.value)} />
            </label>
            <button class="primary-button" disabled={busy || !password} type="submit">{busy ? 'Checking…' : 'Continue'}</button>
          </form>
        )}

        {(validationError || error) && <p role="alert" class="mt-4 rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">{validationError || error}</p>}
      </section>
    </main>
  )
}

export function ConnectionScreen({ error, onRetry }: { error?: string; onRetry?: () => void }) {
  return (
    <main class="grid min-h-screen place-items-center bg-base-200 px-5 text-base-content">
      <div class="flex max-w-md flex-col items-center gap-4 text-center">
        {onRetry ? (
          <>
            <p class="text-sm font-medium">Unable to connect to Telegram</p>
            {error && <p role="alert" class="text-xs text-muted">{error}</p>}
            <button type="button" class="primary-button px-6" onClick={onRetry}>Retry</button>
          </>
        ) : (
          <div class="flex items-center gap-3 text-sm text-muted">
            <span class="loader" /> Connecting to Telegram
          </div>
        )}
      </div>
    </main>
  )
}
