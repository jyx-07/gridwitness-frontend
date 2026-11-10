// FI 교차검증: FRTU 고장표시(FI, 규칙)가 뜬 사건을 사건 전후 전류 파형으로 다시 확인한다.
// 배전자동화(DAS)의 FI는 돌입전류·개폐 과도에도 뜰 수 있어, 잠깐 튀고 바로 돌아온 경우를 "오표시 의심"으로 따로 알린다.
// 판정을 바꾸지는 않는다. 담당자가 현장 확인 전에 참고할 근거만 낸다.
import type { FrtuId } from './frtu'
import type { IncidentPoint, LiveIncident } from './liveIncident'
import type { AnalyzedEvent } from './villageEvents'

export type FiCheckKind = 'CONFIRMED' | 'SUSPECT' | 'UNKNOWN'
export interface FiCheck {
  kind: FiCheckKind
  title: string
  reason: string
  /** 기준을 벗어나 있던 시간 (ms). 모르면 null */
  durationMs: number | null
}

/** 이 시간 안에 원래 수준으로 돌아오면 순간 과도로 봄 */
export const TRANSIENT_MS = 2_000
const MIN_DEV_MA = 5
const REL_DEV = 0.25

const valueOf = (p: IncidentPoint, k: FrtuId): number | null => {
  const a = k === 'inlet' ? p.i : k === 'house' ? p.ih : p.il
  return typeof a === 'number' && Number.isFinite(a) ? a * 1000 : null
}
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** 고장표시가 뜬 FRTU 하나의 파형: 기준을 벗어난 시간과 돌아왔는지 */
function channel(inc: LiveIncident, k: FrtuId): { durationMs: number; returned: boolean } | null {
  const before = inc.points.filter((p) => p.t < inc.startedAt).map((p) => valueOf(p, k)).filter((x): x is number => x != null)
  const after = inc.points.filter((p) => p.t >= inc.startedAt - 500).map((p) => ({ t: p.t, v: valueOf(p, k) })).filter((x): x is { t: number; v: number } => x.v != null)
  if (before.length < 3 || after.length < 2) return null
  const base = median(before)
  const limit = Math.max(Math.abs(base) * REL_DEV, MIN_DEV_MA)
  const off = after.filter((x) => Math.abs(x.v - base) > limit)
  if (!off.length) return { durationMs: 0, returned: true }
  // 마지막 표본이 원래 수준이면 돌아온 것 (복구되면 기록이 그 표본에서 멈춤)
  const last = after[after.length - 1]
  const returned = Math.abs(last.v - base) <= limit
  return { durationMs: off[off.length - 1].t - off[0].t + 500, returned }
}

export function fiCrossCheck(inc: LiveIncident, recorded?: AnalyzedEvent): FiCheck {
  const hit = (Object.keys(inc.fi) as FrtuId[]).filter((k) => inc.fi[k] !== 'NONE')
  if (!hit.length) return { kind: 'UNKNOWN', title: '고장표시 없음', reason: '고장표시가 뜬 FRTU가 없어 교차검증할 대상이 없어요.', durationMs: null }

  // AI가 개폐·재접속 파형으로 봤으면 고장이 아니라 조작 과도일 수 있음
  const v = recorded?.verdict
  if (v && v.kind === 'ANSWERED' && (v.label === 'SWITCH' || v.label === 'RECONNECT')) {
    return { kind: 'SUSPECT', title: 'FI 오표시 의심', reason: `파형 AI가 '${v.labelKo}' 파형으로 봤어요. 개폐·재접속 때 생기는 과도 전류로 고장표시가 떴을 수 있어요.`, durationMs: null }
  }

  const chs = hit.map((k) => channel(inc, k)).filter((x): x is { durationMs: number; returned: boolean } => x != null)
  if (!chs.length) return { kind: 'UNKNOWN', title: '판단 불가', reason: '사건 전 기준 파형이 부족해 고장표시를 파형으로 확인하지 못했어요.', durationMs: null }
  const longest = Math.max(...chs.map((c) => c.durationMs))
  const allReturned = chs.every((c) => c.returned)
  const sec = (ms: number) => `${(ms / 1000).toFixed(1)}초`

  if (allReturned && longest <= TRANSIENT_MS) {
    return { kind: 'SUSPECT', title: 'FI 오표시 의심', reason: `전류가 ${sec(longest)}만 튀고 바로 원래 수준으로 돌아왔어요. 돌입전류·개폐 과도처럼 고장이 아닌데 고장표시가 떴을 수 있어요.`, durationMs: longest }
  }
  return { kind: 'CONFIRMED', title: '파형도 고장 지지', reason: inc.clearedAt ? `전류가 ${sec(longest)} 동안 기준을 벗어나 있었어요. 순간 과도보다 길어 고장표시와 맞아요.` : `전류가 ${sec(longest)} 넘게 기준을 벗어난 채 이어지고 있어요. 고장표시와 맞아요.`, durationMs: longest }
}
