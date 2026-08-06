import { useCallback, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

function readTheme(): Theme {
  try {
    const t = localStorage.getItem('dga_theme')
    if (t === 'dark' || t === 'light') return t
  } catch {
    /* ignore */
  }
  return 'light'
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof document !== 'undefined') {
      const t = readTheme()
      document.documentElement.setAttribute('data-theme', t)
      return t
    }
    return 'light'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try {
      localStorage.setItem('dga_theme', theme)
    } catch {
      /* ignore */
    }
  }, [theme])

  const toggle = useCallback(() => {
    setThemeState((t) => (t === 'light' ? 'dark' : 'light'))
  }, [])

  return { theme, setTheme: setThemeState, toggle }
}
