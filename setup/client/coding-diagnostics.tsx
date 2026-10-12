import { useEffect, useState } from 'react'
import { codingDiagnostics, type CodingDiagnostics as Diagnostics } from './claude-backend.ts'
import { voiceText } from '../../hooks/voice-status-i18n.js'

/**
 * One button for the one symptom people see. Opening the tab checks (which already recovers a request
 * Claude's records show finished); the button is enabled only while a request is still blocking voice, and
 * releases it. Releasing never stops Claude's own work.
 */
export function CodingDiagnostics({ locale }: { locale: string }) {
  const t = (key: string) => voiceText(locale, `troubleshooting.${key}`)
  const [data, setData] = useState<Diagnostics | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')
  async function check() {
    try { setData(await codingDiagnostics.check()) }
    catch { setData(null); setResult(t('checkFailed')) }
  }
  async function fix() {
    if (!data?.task?.canRelease) return
    setBusy(true); setResult('')
    try {
      await codingDiagnostics.release(data)
      setResult(t('fixed'))
    } catch { setResult(t('fixFailed')) }
    finally { setBusy(false); await check() }
  }
  // Kept current while the tab is open, so the button is enabled exactly when pressing it would clear something.
  useEffect(() => {
    void check()
    const timer = setInterval(() => { void check() }, 3000)
    return () => clearInterval(timer)
  }, [])
  const stuck = !!data?.task?.canRelease
  return <section className="coding-diagnostics">
    <div className="coding-diagnostics-panel" role="region" aria-label={t('tab')}>
      <p>{t('cause')}</p>
      <p>{t('instruction')}</p>
      <button disabled={busy || !stuck} onClick={() => void fix()}>{busy ? t('fixing') : t('fix')}</button>
      {result && <p role="status"><strong>{result}</strong></p>}
    </div>
  </section>
}
