import assert from 'node:assert/strict'
import test from 'node:test'
import { english, voiceText } from '../hooks/voice-status-i18n.js'
import catalogs from '../hooks/voice-status-catalogs.js'

test('every shipped Voice status translation is current and keeps its placeholders', () => {
  assert.equal(Object.keys(catalogs).length, 34)
  const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort()
  for (const [locale, catalog] of Object.entries(catalogs)) {
    assert.deepEqual(Object.keys(catalog).sort(), Object.keys(english).sort(), `${locale}: complete catalog`)
    for (const [key, source] of Object.entries(english)) {
      assert.equal(catalog[key].source, source, `${locale}: ${key} current source`)
      assert.deepEqual(placeholders(catalog[key].text), placeholders(source), `${locale}: ${key} placeholders`)
    }
  }
})

test('Voice status lookup uses Claude locale variants and English fallback', () => {
  assert.equal(voiceText('zh-TW', 'status.connectingShort'), voiceText('zh-Hant', 'status.connectingShort'))
  assert.equal(voiceText('es-MX', 'status.connectingShort'), voiceText('es-419', 'status.connectingShort'))
  assert.equal(voiceText('unknown', 'status.connectingShort'), english['status.connectingShort'])
  assert.equal(voiceText('fr-FR', 'status.error', { detail: 'HTTP 403' }).includes('HTTP 403'), true)
})
