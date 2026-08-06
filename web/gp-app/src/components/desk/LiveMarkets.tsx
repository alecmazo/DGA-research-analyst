import { useEffect, useRef } from 'react'
import { Panel } from '@/components/ui/Panel'
import { useTheme } from '@/hooks/useTheme'
import styles from './deskWidgets.module.css'

const TV_SYMBOLS: [string, string][] = [
  ['S&P 500', 'AMEX:SPY|1D'],
  ['Nasdaq 100', 'NASDAQ:QQQ|1D'],
  ['Dow Jones', 'AMEX:DIA|1D'],
  ['Russell 2000', 'AMEX:IWM|1D'],
  ['VIX', 'AMEX:VIXY|1D'],
  ['10Y Treasury', 'AMEX:IEF|1D'],
  ['Long Treasury', 'AMEX:TLT|1D'],
  ['US Dollar', 'AMEX:UUP|1D'],
  ['Gold', 'TVC:GOLD|1D'],
  ['Crude WTI', 'TVC:USOIL|1D'],
  ['Bitcoin', 'BITSTAMP:BTCUSD|1D'],
]

/** TradingView Symbol Overview — same free embed as legacy Desk Live Markets. */
export function LiveMarkets({ bare = false }: { bare?: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const { theme } = useTheme()

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    host.innerHTML = ''

    const wrap = document.createElement('div')
    wrap.className = 'tradingview-widget-container'
    wrap.style.cssText = 'height:100%;width:100%;'
    const inner = document.createElement('div')
    inner.className = 'tradingview-widget-container__widget'
    inner.style.cssText = 'height:calc(100% - 32px);width:100%;'
    wrap.appendChild(inner)
    host.appendChild(wrap)

    const isDark = theme === 'dark'
    const s = document.createElement('script')
    s.type = 'text/javascript'
    s.async = true
    s.src = 'https://s3.tradingview.com/external-embedding/embed-widget-symbol-overview.js'
    s.text = JSON.stringify({
      symbols: TV_SYMBOLS,
      chartOnly: false,
      width: '100%',
      height: 400,
      locale: 'en',
      colorTheme: isDark ? 'dark' : 'light',
      autoSize: true,
      showVolume: false,
      showMA: false,
      hideDateRanges: false,
      hideMarketStatus: false,
      hideSymbolLogo: false,
      scalePosition: 'right',
      scaleMode: 'Normal',
      fontFamily: 'Inter, -apple-system, sans-serif',
      fontSize: '12',
      noTimeScale: false,
      valuesTracking: '1',
      changeMode: 'price-and-percent',
      chartType: 'area',
      headerFontSize: 'medium',
      lineWidth: 2,
      lineType: 0,
      maLineColor: '#5BB8D4',
      maLineWidth: 1,
      maLength: 9,
      backgroundColor: isDark ? 'rgba(24, 34, 58, 0)' : 'rgba(255,255,255,0)',
      lineColor: 'rgba(91, 184, 212, 1)',
      topColor: 'rgba(91, 184, 212, 0.35)',
      bottomColor: 'rgba(91, 184, 212, 0)',
      dateRanges: [
        '1d|1',
        '5d|5',
        '1m|30',
        '3m|60',
        '6m|120',
        'ytd|1D',
        '12m|1D',
        '60m|1W',
        'all|1M',
      ],
    })
    wrap.appendChild(s)

    return () => {
      host.innerHTML = ''
    }
  }, [theme])

  const host = <div ref={hostRef} className={styles.tvHost} />
  if (bare) return host
  return (
    <Panel
      title="Live Markets"
      badge="Real-time"
      action={<span className={styles.metaDim}>via TradingView</span>}
      flush
    >
      {host}
    </Panel>
  )
}
