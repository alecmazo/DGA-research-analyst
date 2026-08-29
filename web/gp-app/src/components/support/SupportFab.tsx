import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { getCachedUser } from '@/lib/auth'
import { useLocation } from 'react-router-dom'
import styles from './SupportFab.module.css'

type Html2CanvasFn = (
  el: HTMLElement,
  opts?: Record<string, unknown>,
) => Promise<HTMLCanvasElement>

function loadHtml2Canvas(): Promise<Html2CanvasFn> {
  const w = window as unknown as { html2canvas?: Html2CanvasFn }
  if (w.html2canvas) return Promise.resolve(w.html2canvas)
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-h2c]')
    if (existing) {
      existing.addEventListener('load', () => {
        if (w.html2canvas) resolve(w.html2canvas)
        else reject(new Error('html2canvas missing'))
      })
      return
    }
    const s = document.createElement('script')
    s.src =
      'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'
    s.async = true
    s.dataset.h2c = '1'
    s.onload = () => {
      if (w.html2canvas) resolve(w.html2canvas)
      else reject(new Error('html2canvas missing'))
    }
    s.onerror = () => reject(new Error('Could not load screenshot library'))
    document.head.appendChild(s)
  })
}

const errorBuf: Array<Record<string, unknown>> = []
function pushErr(entry: Record<string, unknown>) {
  errorBuf.push(entry)
  if (errorBuf.length > 25) errorBuf.shift()
}

let listenersBound = false
function bindErrorListeners() {
  if (listenersBound || typeof window === 'undefined') return
  listenersBound = true
  window.addEventListener('error', (e) => {
    pushErr({
      type: 'error',
      msg: String(e.message || 'error').slice(0, 400),
      src: String(e.filename || '').slice(0, 200),
      line: e.lineno,
      col: e.colno,
      ts: new Date().toISOString(),
    })
  })
  window.addEventListener('unhandledrejection', (e) => {
    let msg = ''
    try {
      const r = e.reason as { message?: string } | string
      msg = String(
        (typeof r === 'object' && r && r.message) || r || 'rejection',
      )
    } catch {
      msg = 'rejection'
    }
    pushErr({
      type: 'unhandledrejection',
      msg: msg.slice(0, 400),
      ts: new Date().toISOString(),
    })
  })
}

export function SupportFab() {
  const loc = useLocation()
  const [open, setOpen] = useState(false)
  const [desc, setDesc] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [shot, setShot] = useState<string | null>(null)
  const [shotMeta, setShotMeta] = useState('—')
  const [busy, setBusy] = useState(false)
  const fabRef = useRef<HTMLButtonElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bindErrorListeners()
  }, [])

  const capture = useCallback(async () => {
    setShotMeta('Capturing page…')
    const fab = fabRef.current
    const bd = backdropRef.current
    const fabDisp = fab?.style.display ?? ''
    const bdVis = bd?.style.visibility ?? ''
    try {
      if (fab) fab.style.display = 'none'
      if (bd) bd.style.visibility = 'hidden'
      const h2c = await loadHtml2Canvas()
      const canvas = await h2c(document.body, {
        scale: Math.min(1, 1200 / Math.max(document.documentElement.scrollWidth, 1)),
        useCORS: true,
        allowTaint: true,
        logging: false,
        windowWidth: document.documentElement.clientWidth,
        windowHeight: Math.min(document.documentElement.scrollHeight, 2400),
      })
      let out = canvas
      const maxW = 1280
      if (canvas.width > maxW) {
        const c2 = document.createElement('canvas')
        c2.width = maxW
        c2.height = Math.round(canvas.height * (maxW / canvas.width))
        const ctx = c2.getContext('2d')
        ctx?.drawImage(canvas, 0, 0, c2.width, c2.height)
        out = c2
      }
      let quality = 0.58
      let dataUrl = out.toDataURL('image/jpeg', quality)
      while (dataUrl.length > 700000 && quality > 0.28) {
        quality -= 0.08
        dataUrl = out.toDataURL('image/jpeg', quality)
      }
      setShot(dataUrl)
      const kb = Math.round((dataUrl.length * 0.75) / 1024)
      setShotMeta(`Screenshot ready · ~${kb} KB`)
      return dataUrl
    } catch (e) {
      setShot(null)
      setShotMeta('Screenshot skipped')
      console.warn('[support] capture', e)
      return null
    } finally {
      if (fab) fab.style.display = fabDisp
      if (bd) bd.style.visibility = bdVis || ''
    }
  }, [])

  const openModal = useCallback(() => {
    setStatus(null)
    setOpen(true)
    window.setTimeout(() => void capture(), 80)
  }, [capture])

  // Settings "File ticket" and other UI can open the same modal.
  useEffect(() => {
    const onOpen = () => openModal()
    window.addEventListener('dga-open-support', onOpen)
    ;(window as unknown as { openDGASupport?: () => void }).openDGASupport = openModal
    return () => {
      window.removeEventListener('dga-open-support', onOpen)
      delete (window as unknown as { openDGASupport?: () => void }).openDGASupport
    }
  }, [openModal])

  const submit = async () => {
    const text = desc.trim()
    if (text.length < 8) {
      setStatus('Please describe the issue in a sentence or two.')
      return
    }
    setBusy(true)
    setStatus('Uploading ticket…')
    let shotData = shot
    if (!shotData) {
      try {
        shotData = await capture()
      } catch {
        /* ok */
      }
    }
    const user = getCachedUser()
    try {
      const j = await api<{
        ok?: boolean
        id?: string
        has_screenshot?: boolean
        error?: string
        detail?: string
      }>('/api/support/tickets', {
        method: 'POST',
        body: JSON.stringify({
          description: text,
          page_url: location.href,
          page_path: location.pathname + location.search + location.hash,
          active_tab: loc.pathname.replace(/^\//, '') || 'desk',
          user_agent: navigator.userAgent,
          viewport: {
            w: window.innerWidth,
            h: window.innerHeight,
            dpr: window.devicePixelRatio || 1,
            scrollY: window.scrollY || 0,
          },
          console_errors: errorBuf.slice(-20),
          context: {
            theme: document.documentElement.getAttribute('data-theme') || '',
            title: document.title,
            role: user?.role || 'gp',
            user: user?.email || user?.lp_id || null,
            name: user?.name || '',
          },
          screenshot_b64: shotData || null,
          screenshot_mime: 'image/jpeg',
          priority: 'normal',
        }),
      })
      if (!j.ok) throw new Error(j.error || j.detail || 'Submit failed')
      setStatus(
        `✓ Ticket ${j.id || ''} filed${j.has_screenshot ? ' with screenshot' : ''}. See Settings → Support.`,
      )
      setDesc('')
      window.setTimeout(() => setOpen(false), 1600)
    } catch (e) {
      setStatus(`❌ ${e instanceof Error ? e.message : 'failed'}`)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <button
        ref={fabRef}
        type="button"
        className={styles.fab}
        title="Report a problem — captures this page"
        aria-label="File support ticket"
        onClick={openModal}
      >
        <span className={styles.fabIco}>🛟</span>
        <span className={styles.fabLabel}>Support</span>
      </button>

      {open && (
        <div
          ref={backdropRef}
          className={styles.backdrop}
          role="dialog"
          aria-modal="true"
          aria-labelledby="dga-support-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false)
          }}
        >
          <div className={styles.modal}>
            <h3 id="dga-support-title">Report a problem</h3>
            <p className={styles.sub}>
              Describe what broke. A screenshot of this page is attached
              automatically so we can see what you see.
            </p>
            <textarea
              className={styles.ta}
              placeholder="e.g. Desk cards won’t drag; Saved Reports click does nothing…"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              autoFocus
            />
            <div className={styles.shotRow}>
              <button
                type="button"
                className={styles.ghost}
                onClick={() => void capture()}
              >
                ↻ Re-capture screenshot
              </button>
              <span className={styles.shotMeta}>{shotMeta}</span>
            </div>
            <div className={styles.shotPrev}>
              {shot ? (
                <img src={shot} alt="Page screenshot" />
              ) : (
                <div className={styles.shotPh}>Screenshot preview</div>
              )}
            </div>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.ghost}
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.go}
                disabled={busy}
                onClick={() => void submit()}
              >
                {busy ? 'Submitting…' : 'Submit ticket'}
              </button>
            </div>
            {status && <div className={styles.status}>{status}</div>}
          </div>
        </div>
      )}
    </>
  )
}
