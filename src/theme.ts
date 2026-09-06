export type Theme = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'telefast-theme'
const colorScheme = matchMedia('(prefers-color-scheme: dark)')

export function getTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored === 'light' || stored === 'dark' ? stored : 'system'
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme === 'system'
    ? colorScheme.matches ? 'dark' : 'light'
    : theme
}

export function setTheme(theme: Theme) {
  if (theme === 'system') localStorage.removeItem(STORAGE_KEY)
  else localStorage.setItem(STORAGE_KEY, theme)
  applyTheme(theme)
}

export function initializeTheme() {
  applyTheme(getTheme())
  colorScheme.addEventListener('change', () => {
    if (getTheme() === 'system') applyTheme('system')
  })
}
