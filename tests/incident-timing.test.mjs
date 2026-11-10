import test from 'node:test'
import assert from 'node:assert/strict'
import { fmtDur, incidentTiming, mean } from '../src/lib/incidentTiming.ts'

const base = { startedAt: 1_000_000, clearedAt: null, stageLog: [{ stage: 'RECEIVED', at: 1_000_000, by: 'auto' }] }

test('measures each step from the moment the fault indicator appeared', () => {
  const inc = { ...base, clearedAt: 1_090_000, stageLog: [...base.stageLog, { stage: 'DISPATCHED', at: 1_030_000, by: 'kim' }] }
  const recorded = { e: { receivedAt: new Date(1_002_500).toISOString() } }
  assert.deepEqual(incidentTiming(inc, recorded), { causeMs: 0, aiMs: 2_500, dispatchMs: 30_000, restoreMs: 90_000, closeMs: null })
})

test('leaves steps that did not happen empty instead of inventing a time', () => {
  const t = incidentTiming(base)
  assert.equal(t.aiMs, null)
  assert.equal(t.dispatchMs, null)
  assert.equal(t.restoreMs, null)
  assert.equal(fmtDur(t.aiMs), '—')
  assert.equal(mean([null, null]), null)
  assert.equal(mean([1_000, null, 3_000]), 2_000)
})

test('formats durations for the screen', () => {
  assert.equal(fmtDur(0), '즉시')
  assert.equal(fmtDur(400), '1초 미만')
  assert.equal(fmtDur(12_000), '12초')
  assert.equal(fmtDur(125_000), '2분 5초')
})
