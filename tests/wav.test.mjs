import assert from 'node:assert/strict'
import test from 'node:test'
import { pcm16ToWav } from '../host/wav.js'

test('wraps 16-bit mono PCM in a 44-byte WAV header', () => {
  const pcm = Buffer.from([1, 0, 2, 0, 3, 0])
  const wav = pcm16ToWav(pcm, 24000)
  assert.equal(wav.length, 44 + pcm.length)
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
  assert.equal(wav.readUInt32LE(4), 36 + pcm.length)
  assert.equal(wav.toString('ascii', 8, 16), 'WAVEfmt ')
  assert.equal(wav.readUInt16LE(20), 1, 'PCM')
  assert.equal(wav.readUInt16LE(22), 1, 'mono')
  assert.equal(wav.readUInt32LE(24), 24000)
  assert.equal(wav.readUInt32LE(28), 48000, 'byte rate')
  assert.equal(wav.readUInt16LE(34), 16, 'bits per sample')
  assert.equal(wav.toString('ascii', 36, 40), 'data')
  assert.equal(wav.readUInt32LE(40), pcm.length)
  assert.deepEqual(wav.subarray(44), pcm)
})
