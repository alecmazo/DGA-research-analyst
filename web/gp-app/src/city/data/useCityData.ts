import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { citySchema, type CityPayload } from '../schema'

export function useCityData() {
  const [data, setData] = useState<CityPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [banner, setBanner] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api<unknown>('/api/v2/gp/portfolio-city?metric=market_cap&privacy=auto')
      .then((raw) => {
        if (!alive) return
        const parsed = citySchema.safeParse(raw)
        if (!parsed.success) {
          setBanner('The city payload did not match the schema. No buildings were invented.')
          setData(null)
          return
        }
        setData(parsed.data)
        setBanner(null)
      })
      .catch((err: unknown) => {
        if (!alive) return
        const message = err instanceof Error ? err.message : 'The city book did not load.'
        setError(message)
      })
    return () => {
      alive = false
    }
  }, [])

  return { data, error, banner }
}

export function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'))
  } catch {
    return false
  }
}
