import { useEffect, useState } from 'react'
import { codingDiagnostics, type CodingDiagnostics as Diagnostics } from './claude-backend.ts'

/**
 * One button for the one symptom people see. Opening the tab checks (which already recovers a request
 * Claude's records show finished); the button is enabled only while a request is still blocking voice, and
 * releases it. Releasing never stops Claude's own work.
 */
export function CodingDiagnostics() {
  const [data, setData] = useState<Diagnostics | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')
  async function check() {
    try { setData(await codingDiagnostics.check()) }
    catch { setData(null); setResult('Couldn’t check. Make sure voice is connected, then reopen this tab.') }
  }
  async function fix() {
    if (!data?.task?.canRelease) return
    setBusy(true); setResult('')
    try {
      await codingDiagnostics.release(data)
      setResult('Fixed. Try your voice request again.')
    } catch { setResult('Couldn’t fix it. Make sure voice is connected, then try again.') }
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
    <div className="coding-diagnostics-panel" role="region" aria-label="Voice coding requests">
      <p>Sometimes an earlier coding request remains marked as running after Claude finishes. This can prevent new
        voice coding requests from starting.</p>
      <p>If the button below is enabled, press it to clear the earlier request so new voice coding requests can start.
        This does not cancel Claude’s work.</p>
      <button disabled={busy || !stuck} onClick={() => void fix()}>{busy ? 'Fixing…' : 'Fix voice coding requests'}</button>
      {result && <p role="status"><strong>{result}</strong></p>}
    </div>
  </section>
}
