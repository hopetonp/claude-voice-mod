import assert from 'node:assert/strict'
import test from 'node:test'
import { join } from 'node:path'
import { claudeDesktopConfigPath, claudeDesktopTheme } from '../host/claude-theme.js'

test('Desktop theme follows Claude Desktop preference, not Claude Code theme', async () => {
  assert.equal(claudeDesktopConfigPath('darwin', {}, '/home/example'),
    join('/home/example', 'Library', 'Application Support', 'Claude', 'config.json'))
  assert.equal(claudeDesktopConfigPath('win32', { APPDATA: 'C:\\Users\\Example\\AppData\\Roaming' }, '/home/example'),
    join('C:\\Users\\Example\\AppData\\Roaming', 'Claude', 'config.json'))
  assert.equal(await claudeDesktopTheme('/ignored', async () => JSON.stringify({ userThemeMode: 'light' })), 'light')
  assert.equal(await claudeDesktopTheme('/ignored', async () => JSON.stringify({ userThemeMode: 'dark' })), 'dark')
  assert.equal(await claudeDesktopTheme('/ignored', async () => JSON.stringify({ userThemeMode: 'system' }), 'darwin', async () => ({ stdout: 'Dark\n' })), 'dark')
  assert.equal(await claudeDesktopTheme('/ignored', async () => JSON.stringify({ userThemeMode: 'system' }), 'darwin', async () => ({ stdout: '' })), 'light')
  assert.equal(await claudeDesktopTheme('/ignored', async () => JSON.stringify({ userThemeMode: 'system' }), 'win32', async () => ({ stdout: 'AppsUseLightTheme    REG_DWORD    0x0\n' })), 'dark')
})

test('Windows system theme polling never opens a registry console window', async () => {
  let queries = 0
  const run = async (command, args, options) => {
    queries++
    assert.equal(command, 'reg')
    assert.equal(args.at(-1), 'AppsUseLightTheme')
    assert.equal(options.windowsHide, true)
    return { stdout: 'AppsUseLightTheme    REG_DWORD    0x1\n' }
  }
  for (let poll = 0; poll < 4; poll++) {
    assert.equal(await claudeDesktopTheme('/ignored', async () => '{"userThemeMode":"system"}', 'win32', run), 'light')
  }
  assert.equal(queries, 4)
})
