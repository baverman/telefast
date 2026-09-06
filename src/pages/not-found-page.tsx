import { useTelegram } from '../telegram/telegram-provider'

export function NotFoundPage() {
  const { status } = useTelegram()
  const home = status === 'authenticated' ? '/chat' : '/login'

  return (
    <main class="grid min-h-screen place-items-center bg-base-200 p-5 text-base-content">
      <section class="text-center">
        <p class="text-sm text-muted">404</p>
        <h1 class="mt-2 text-2xl font-semibold">Page not found</h1>
        <a class="mt-5 inline-block rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-content" href={home}>
          Return to Telefast
        </a>
      </section>
    </main>
  )
}
