import { readFile, mkdir, writeFile, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

export const voiceDisplayDefaults = { multiline: true, maxLines: 8 }
const validLines = value => Number.isInteger(value) && value >= 1 && value <= 10

export function createVoiceDisplaySettings(path) {
  let tail = Promise.resolve()
  const read = async () => {
    let saved = {}
    try { saved = JSON.parse(await readFile(path, 'utf8')) ?? {} } catch {}
    return { multiline: typeof saved.multiline === 'boolean' ? saved.multiline : voiceDisplayDefaults.multiline,
      maxLines: validLines(saved.maxLines) ? saved.maxLines : voiceDisplayDefaults.maxLines }
  }
  return {
    read,
    save(changes) {
      const operation = tail.then(async () => {
        if (!changes || typeof changes !== 'object' || Array.isArray(changes)
          || !Object.keys(voiceDisplayDefaults).some(key => changes[key] !== undefined)) throw new Error('Choose a display setting')
        for (const key of ['multiline']) {
          if (changes[key] !== undefined && typeof changes[key] !== 'boolean') throw new Error(`${key} must be a boolean`)
        }
        if (changes.maxLines !== undefined && !validLines(changes.maxLines)) throw new Error('Maximum voice lines must be an integer from 1 to 10')
        const next = { ...await read(), ...Object.fromEntries(Object.keys(voiceDisplayDefaults)
          .filter(key => changes[key] !== undefined).map(key => [key, changes[key]])) }
        await mkdir(dirname(path), { recursive: true })
        const temporary = join(dirname(path), `.voice-display-${randomUUID()}`)
        try { await writeFile(temporary, JSON.stringify(next), { mode: 0o600, flag: 'wx' }); await rename(temporary, path) }
        finally { await rm(temporary, { force: true }) }
        return next
      })
      tail = operation.catch(() => {})
      return operation
    },
  }
}
