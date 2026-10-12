import { readFile, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const plainText = row => typeof row.message?.content === 'string' ? row.message.content
  : Array.isArray(row.message?.content) && row.message.content.every(part => part.type === 'text')
    ? row.message.content.map(part => part.text ?? '').join('\n') : null

/** Recover only an exact plugin-submitted request with a completed main-turn ancestry. */
export function completionFromTranscript(task, text) {
  if (task?.status !== 'running' || !task.turnId || !Number.isSafeInteger(task.claimedAt)) return null
  const lines = text.split('\n')
  const rows = []
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].trim()) continue
    try { rows.push(JSON.parse(lines[index])) }
    catch { if (index !== lines.length - 1) return null }
  }
  const candidates = rows.filter(row => row.type === 'user' && row.sessionId === task.sessionId
    && !row.isSidechain && !row.isMeta && row.origin?.kind === 'plugin'
    && row.origin.name === 'voicemesh-controls' && row.origin.asUser === true
    && typeof row.uuid === 'string' && typeof row.promptId === 'string'
    && plainText(row)?.trim() === task.text.trim()
    && Date.parse(row.timestamp) >= task.claimedAt
    && Date.parse(row.timestamp) - task.claimedAt <= 60_000)
  if (candidates.length !== 1) return null
  const root = candidates[0]
  const descendants = new Set([root.uuid])
  const finals = new Map()
  for (const row of rows.slice(rows.indexOf(root) + 1)) {
    if (row.sessionId !== task.sessionId || row.isSidechain || !descendants.has(row.parentUuid)) continue
    // A new prompt may descend from this answer, but its work is a different turn.
    if (row.type === 'user' && row.promptId && row.promptId !== root.promptId) continue
    if (typeof row.uuid === 'string') descendants.add(row.uuid)
    if (row.type === 'assistant' && row.message?.stop_reason === 'end_turn') {
      const answer = plainText(row)
      if (answer?.trim()) finals.set(row.uuid, answer.slice(0, 16000))
    }
    // end_turn alone is insufficient: a Stop hook may request continuation.
    if (row.type === 'system' && row.subtype === 'stop_hook_summary'
      && row.preventedContinuation === false && Array.isArray(row.hookErrors) && !row.hookErrors.length
      && finals.has(row.parentUuid)) {
      return { status: 'complete', text: finals.get(row.parentUuid), evidence: 'claude-transcript-completion' }
    }
  }
  return null
}

/** Missing/ambiguous evidence never clears a running task. Polling is bounded per task. */
export function createClaudeTaskRecovery({ projects = join(homedir(), '.claude', 'projects'), now = Date.now } = {}) {
  const cache = new Map()
  return async (task, cwd = '') => {
    if (task?.status !== 'running') return null
    if (!/^[\w-]{1,128}$/.test(task.sessionId)) return null
    const key = `${task.sessionId}:${task.id}:${task.turnId}`
    const previous = cache.get(key)
    if (previous && now() - previous.at < 5000) return previous.completion
    let completion = null
    const file = `${task.sessionId}.jsonl`
    const folders = [...new Set([cwd && cwd.replace(/[^a-zA-Z0-9]/g, '-'),
      ...await readdir(projects).catch(() => [])].filter(Boolean))]
    for (const folder of folders) {
      const transcript = await readFile(join(projects, folder, file), 'utf8').catch(() => '')
      if (!transcript) continue
      completion = completionFromTranscript(task, transcript)
      break
    }
    if (cache.size > 128) cache.clear()
    cache.set(key, { at: now(), completion })
    return completion
  }
}
