import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Claude stores its signed-in account profile in this local configuration file. */
export async function claudeUserName(path = join(homedir(), '.claude.json')) {
  try {
    const account = JSON.parse(await readFile(path, 'utf8')).oauthAccount
    const name = account?.displayName || account?.fullName
    if (typeof name !== 'string') return ''
    if (/[\r\n\p{Cc}]/u.test(name)) return ''
    const clean = name.trim().replace(/\s+/g, ' ')
    return clean.length <= 80 && /^[\p{L}\p{M}][\p{L}\p{M}\p{Zs}'.-]*$/u.test(clean) ? clean : ''
  } catch {
    return ''
  }
}
