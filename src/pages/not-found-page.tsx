import { useTelegram } from '../telegram/telegram-provider'

export function NotFoundPage() {
  const { status } = useTelegram()
  const home = status === 'authenticated' ? '/' : '/login'

  return (
    <main class="grid min-h-screen place-items-center bg-zinc-950 p-5 text-zinc-100">
      <section class="text-center">
        <p class="text-sm text-zinc-500">404</p>
        <h1 class="mt-2 text-2xl font-semibold">Page not found</h1>
        <a class="mt-5 inline-block rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-400" href={home}>
          Return to Telefast
        </a>
      </section>
    </main>
  )
}
