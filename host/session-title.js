// A Claude session's name as the desktop sidebar shows it: the newest title its transcript records.
import { readFile, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const TITLE = /"(?:customTitle|aiTitle)":"((?:[^"\\]|\\.)*)"/g

/** Reads the newest saved title of a session, or '' when it has none or the transcript cannot be found. */
export async function sessionTitle(sessionId, cwd, projects = join(homedir(), '.claude', 'projects')) {
  if (typeof sessionId !== 'string' || !/^[\w-]{1,128}$/.test(sessionId)) return ''
  const file = `${sessionId}.jsonl`
  const guess = typeof cwd === 'string' && cwd ? join(projects, cwd.replace(/[^a-zA-Z0-9]/g, '-'), file) : ''
  let text = guess ? await readFile(guess, 'utf8').catch(() => '') : ''
  if (!text) {
    for (const folder of await readdir(projects).catch(() => [])) {
      text = await readFile(join(projects, folder, file), 'utf8').catch(() => '')
      if (text) break
    }
  }
  let title = ''
  for (const match of text.matchAll(TITLE)) title = match[1]
  try { return title ? JSON.parse(`"${title}"`).trim().slice(0, 80) : '' } catch { return '' }
}
