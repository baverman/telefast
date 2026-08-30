import { render } from 'preact'
import { LocationProvider } from 'preact-iso'
import { QueryClient, QueryClientProvider } from '@tanstack/preact-query'
import { App } from './app'
import './styles.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: true, gcTime: 10 * 60_000 },
    mutations: { retry: 0 },
  },
})

render(
  <LocationProvider>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </LocationProvider>,
  document.getElementById('app')!,
)
