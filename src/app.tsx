import { Route, Router } from 'preact-iso'
import { ChatListPage } from './pages/chat-list-page'
import { ChatPage } from './pages/chat-page'
import { LoginPage } from './pages/login-page'
import { NotFoundPage } from './pages/not-found-page'
import { TelegramProvider } from './telegram/telegram-provider'
import { FaviconBadge } from './components/favicon-badge'

export function App() {
  return (
    <TelegramProvider>
      <FaviconBadge />
      <Router>
        <Route path="/login" component={LoginPage} />
        <Route path="/" component={ChatListPage} />
        <Route path="/chat/:peerId" component={ChatPage} />
        <Route default component={NotFoundPage} />
      </Router>
    </TelegramProvider>
  )
}
