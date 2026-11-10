import test from 'node:test'
import assert from 'node:assert/strict'
import { fiCrossCheck } from '../src/lib/fiCheck.ts'

const T0 = 1_000_000
// 0.5초 간격 표본. house는 평소 33mA
const pts = (houseAfter) => [
  ...Array.from({ length: 6 }, (_, k) => ({ t: T0 - 3000 + k * 500, i: 0.055, ih: 0.033, il: 0.022 })),
  ...houseAfter.map((mA, k) => ({ t: T0 + k * 500, i: 0.022 + mA / 1000, ih: mA / 1000, il: 0.022 })),
]
const inc = (house, clearedAt) => ({ startedAt: T0, clearedAt, fi: { inlet: 'HIGH', house: 'HIGH', lamp: 'NONE' }, points: pts(house) })

test('a short spike that returns is flagged as a possible false fault indication', () => {
  const r = fiCrossCheck(inc([250, 250, 34, 33], T0 + 1500))
  assert.equal(r.kind, 'SUSPECT')
  assert.ok(r.durationMs <= 2000)
})

test('a sustained change supports the fault indication', () => {
  const r = fiCrossCheck(inc([250, 250, 252, 249, 251, 250, 250], null))
  assert.equal(r.kind, 'CONFIRMED')
})

test('an AI switching verdict is treated as a possible false indication', () => {
  const recorded = { verdict: { kind: 'ANSWERED', label: 'SWITCH', labelKo: '개폐 명령' } }
  assert.equal(fiCrossCheck(inc([250, 250, 252, 249], null), recorded).kind, 'SUSPECT')
})

test('without enough pre-event samples it does not guess', () => {
  const x = { startedAt: T0, clearedAt: null, fi: { inlet: 'HIGH', house: 'NONE', lamp: 'NONE' }, points: [{ t: T0, i: 0.3, ih: null, il: null }] }
  assert.equal(fiCrossCheck(x).kind, 'UNKNOWN')
})
