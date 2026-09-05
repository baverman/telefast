import { Route, Router } from 'preact-iso'
import { ChatLayout } from './components/chat-layout'
import { SessionFavicon, UnreadFaviconBadge } from './components/favicon-badge'
import { LoginPage } from './pages/login-page'
import { NotFoundPage } from './pages/not-found-page'
import { Redirect } from './routing/redirect'
import { TelegramProvider } from './telegram/telegram-provider'

function HomeRedirect() {
  return <Redirect to="/chat" />
}

function AuthenticatedApp() {
  return (
    <>
      <SessionFavicon />
      <UnreadFaviconBadge />
      <Router>
        <Route path="/login" component={HomeRedirect} />
        <Route path="/" component={HomeRedirect} />
        <Route path="/chat" component={ChatLayout} />
        <Route path="/chat/*" component={ChatLayout} />
        <Route default component={NotFoundPage} />
      </Router>
    </>
  )
}

export function App() {
  const fallback = (
    <>
      <SessionFavicon />
      <LoginPage />
    </>
  )
  return (
    <TelegramProvider fallback={fallback}>
      <AuthenticatedApp />
    </TelegramProvider>
  )
}
