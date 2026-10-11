import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const terminal = new Set(['complete', 'aborted', 'failed'])
const validRow = row => row && typeof row === 'object' && !Array.isArray(row)
  && typeof row.id === 'string' && row.id.length > 0 && row.id.length <= 128
  && typeof row.sessionId === 'string' && row.sessionId.length > 0 && row.sessionId.length <= 256
  && Number.isSafeInteger(row.playbackId) && row.playbackId > 0
  && terminal.has(row.status) && typeof row.text === 'string' && row.text.length <= 16000
  && typeof row.played === 'boolean'

/** Terminal coding results remain owed until Composer reports completed playback. */
export async function createResultLedger(path) {
  let state = { nextPlaybackId: 1, rows: [] }
  try {
    const loaded = JSON.parse(await readFile(path, 'utf8'))
    if (!loaded || !Number.isSafeInteger(loaded.nextPlaybackId) || loaded.nextPlaybackId < 1
      || !Array.isArray(loaded.rows) || loaded.rows.length > 1024 || !loaded.rows.every(validRow)) {
      throw new Error('Invalid saved VoiceMesh result ledger')
    }
    state = loaded
  } catch (error) { if (error.code !== 'ENOENT') throw error }

  let tail = Promise.resolve()
  const persist = () => {
    const snapshot = JSON.stringify(state) + '\n'
    const operation = tail.then(async () => {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      const temporary = join(dirname(path), `.result-${randomUUID()}`)
      try {
        await writeFile(temporary, snapshot, { flag: 'wx', mode: 0o600 })
        await rename(temporary, path)
      } finally { await rm(temporary, { force: true }) }
    })
    tail = operation.catch(() => {})
    return operation
  }
  const owed = sessionId => state.rows.filter(row => row.sessionId === sessionId && !row.played)
  const latest = sessionId => [...state.rows].reverse().find(row => row.sessionId === sessionId) ?? null
  const allocate = async () => {
    if (state.rows.filter(row => !row.played).length >= 1024) throw new Error('Voice result queue is full')
    if (state.nextPlaybackId >= Number.MAX_SAFE_INTEGER) throw new Error('Voice playback counter exhausted')
    const playbackId = state.nextPlaybackId++
    await persist()
    return playbackId
  }
  const record = async task => {
    const row = { id: task.id, sessionId: task.sessionId, playbackId: task.playbackId,
      status: task.status, text: task.result ?? '', played: false }
    if (!validRow(row)) throw new Error('Invalid terminal voice result')
    const existing = state.rows.find(item => item.id === row.id)
    if (existing) {
      if (existing.sessionId !== row.sessionId || existing.playbackId !== row.playbackId
        || existing.status !== row.status || existing.text !== row.text) throw new Error('Voice result identity changed')
      return existing
    }
    state.rows.push(row)
    while (state.rows.length > 1024) {
      const playedIndex = state.rows.findIndex(item => item.played)
      if (playedIndex < 0) throw new Error('Voice result queue is full')
      state.rows.splice(playedIndex, 1)
    }
    await persist()
    return row
  }
  const markPlayed = async (playbackId, sessionId) => {
    const row = state.rows.find(item => item.playbackId === playbackId && item.sessionId === sessionId)
    if (!row || row.played) return false
    row.played = true
    await persist()
    return true
  }
  const owedSessions = () => [...new Set(state.rows.filter(row => !row.played).map(row => row.sessionId))]
  return { allocate, record, owed, owedSessions, latest, markPlayed }
}
