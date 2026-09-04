import { Route, Router } from 'preact-iso'
import { ChatLayout } from './components/chat-layout'
import { FaviconBadge } from './components/favicon-badge'
import { LoginPage } from './pages/login-page'
import { NotFoundPage } from './pages/not-found-page'
import { Redirect } from './routing/redirect'
import { TelegramProvider } from './telegram/telegram-provider'

function HomeRedirect() {
  return <Redirect to="/chat" />
}

export function App() {
  return (
    <TelegramProvider>
      <FaviconBadge />
      <Router>
        <Route path="/login" component={LoginPage} />
        <Route path="/" component={HomeRedirect} />
        <Route path="/chat" component={ChatLayout} />
        <Route path="/chat/*" component={ChatLayout} />
        <Route default component={NotFoundPage} />
      </Router>
    </TelegramProvider>
  )
}
