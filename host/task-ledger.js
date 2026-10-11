import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const statuses = new Set(['queued', 'claimed', 'submitting', 'running', 'complete', 'aborted', 'failed', 'reviewed'])
const valid = task => task && typeof task === 'object' && !Array.isArray(task)
  && typeof task.id === 'string' && task.id.length > 0 && task.id.length <= 128
  && typeof task.text === 'string' && task.text.trim().length > 0 && task.text.length <= 16000
  && ['submit', 'review'].includes(task.mode) && statuses.has(task.status)
  && typeof task.sessionId === 'string' && task.sessionId.length > 0 && task.sessionId.length <= 256
  && (task.playbackId === undefined || Number.isSafeInteger(task.playbackId) && task.playbackId > 0)
  && (task.claimedAt === undefined || Number.isSafeInteger(task.claimedAt) && task.claimedAt > 0)
  && (task.submissionState === undefined || task.submissionState === 'not-started' || task.submissionState === 'started')
  && (task.turnId === null || typeof task.turnId === 'string' && task.turnId.length <= 256)
  && (task.result === null || typeof task.result === 'string' && task.result.length <= 16000)

/** One durable Claude request per session, so a restarted host never invents or replays a claim. */
export async function createTaskLedger(path) {
  let tasks = {}
  try {
    const stored = JSON.parse(await readFile(path, 'utf8'))
    // Before sessions, the file held one task; it becomes that task's session entry.
    const entries = stored?.tasks && typeof stored.tasks === 'object' ? Object.values(stored.tasks) : [stored]
    for (const task of entries) {
      if (!valid(task)) throw new Error('Invalid saved Claude voice request')
      tasks[task.sessionId] = task
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  let tail = Promise.resolve()
  const save = task => {
    if (!valid(task)) throw new Error('Invalid Claude voice request')
    const next = { ...tasks, [task.sessionId]: task }
    const operation = tail.then(async () => {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      const temporary = join(dirname(path), `.task-${randomUUID()}`)
      try {
        await writeFile(temporary, JSON.stringify({ tasks: next }) + '\n', { flag: 'wx', mode: 0o600 })
        await rename(temporary, path)
      } finally { await rm(temporary, { force: true }) }
      tasks = { ...tasks, [task.sessionId]: task }
      return task
    })
    tail = operation.catch(() => {})
    return operation
  }
  return { get: sessionId => tasks[sessionId] ?? null, all: () => Object.values(tasks), save }
}
