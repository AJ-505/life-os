import { createContext, useContext, useEffect, useState } from 'react'
import { MoonStar, SunMedium } from 'lucide-react'

import { Button } from '#/design-system/ui/button'

type Theme = 'light' | 'dark'

const STORAGE_KEY = 'lifeos-theme'

/** Inlined into <head> so the right class lands before first paint. */
export const THEME_INIT_SCRIPT = `(function(){try{var q=new URLSearchParams(location.search).get('theme');var t=q||localStorage.getItem('${STORAGE_KEY}');var d=t? t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d)}catch(e){}})()`

const ThemeContext = createContext<{
  theme: Theme
  setTheme: (t: Theme) => void
}>({ theme: 'light', setTheme: () => {} })

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('light')

  useEffect(() => {
    setThemeState(
      document.documentElement.classList.contains('dark') ? 'dark' : 'light',
    )
  }, [])

  const setTheme = (t: Theme) => {
    setThemeState(t)
    document.documentElement.classList.toggle('dark', t === 'dark')
    localStorage.setItem(STORAGE_KEY, t)
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}

export function ModeToggle() {
  const { theme, setTheme } = useTheme()
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
    >
      {theme === 'dark' ? (
        <MoonStar className="size-4" />
      ) : (
        <SunMedium className="size-4" />
      )}
    </Button>
  )
}
