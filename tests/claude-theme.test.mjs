import assert from 'node:assert/strict'
import test from 'node:test'
import { claudeDesktopConfigPath, claudeDesktopTheme } from '../host/claude-theme.js'

test('Desktop theme follows Claude Desktop preference, not Claude Code theme', async () => {
  assert.equal(claudeDesktopConfigPath('darwin', {}, '/home/example'),
    '/home/example/Library/Application Support/Claude/config.json')
  assert.equal(claudeDesktopConfigPath('win32', { APPDATA: 'C:\\Users\\Example\\AppData\\Roaming' }, '/home/example'),
    'C:\\Users\\Example\\AppData\\Roaming/Claude/config.json')
  assert.equal(await claudeDesktopTheme('/ignored', async () => JSON.stringify({ userThemeMode: 'light' })), 'light')
  assert.equal(await claudeDesktopTheme('/ignored', async () => JSON.stringify({ userThemeMode: 'dark' })), 'dark')
  assert.equal(await claudeDesktopTheme('/ignored', async () => JSON.stringify({ userThemeMode: 'system' }), 'darwin', async () => ({ stdout: 'Dark\n' })), 'dark')
  assert.equal(await claudeDesktopTheme('/ignored', async () => JSON.stringify({ userThemeMode: 'system' }), 'darwin', async () => ({ stdout: '' })), 'light')
  assert.equal(await claudeDesktopTheme('/ignored', async () => JSON.stringify({ userThemeMode: 'system' }), 'win32', async () => ({ stdout: 'AppsUseLightTheme    REG_DWORD    0x0\n' })), 'dark')
})
