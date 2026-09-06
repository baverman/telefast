import { render } from 'preact'
import { LocationProvider } from 'preact-iso'
import { App } from './app'
import './styles.css'
import { initializeTheme } from './theme'
import { initializeMediaStreaming } from './telegram/media-stream'

initializeTheme()


await initializeMediaStreaming()

render(
  <LocationProvider>
    <App />
  </LocationProvider>,
  document.getElementById('app')!,
)
