import { create } from 'zustand'
import type { Metric } from './metrics'

type Motion = 'auto' | 'on' | 'off'

type CityState = {
  selectedId: string | null
  hoverId: string | null
  metric: Metric
  night: boolean
  flyover: boolean
  motion: Motion
  listOpen: boolean
  resetNonce: number
  setSelected: (id: string | null) => void
  setHover: (id: string | null) => void
  setMetric: (metric: Metric) => void
  setNight: (night: boolean) => void
  setFlyover: (flyover: boolean) => void
  setMotion: (motion: Motion) => void
  setListOpen: (open: boolean) => void
  bumpReset: () => void
}

export const useCityState = create<CityState>((set) => ({
  selectedId: null,
  hoverId: null,
  metric: 'market_cap',
  night: true,
  flyover: false,
  motion: 'auto',
  listOpen: false,
  resetNonce: 0,
  setSelected: (selectedId) => set({ selectedId }),
  setHover: (hoverId) => set({ hoverId }),
  setMetric: (metric) => set({ metric }),
  setNight: (night) => set({ night }),
  setFlyover: (flyover) => set({ flyover }),
  setMotion: (motion) => set({ motion }),
  setListOpen: (listOpen) => set({ listOpen }),
  bumpReset: () => set((state) => ({ resetNonce: state.resetNonce + 1, selectedId: null, flyover: false })),
}))
