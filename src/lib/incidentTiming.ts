// 사건 처리 시간: 고장표시(감지)부터 원인 후보·AI 판정·출동·복구까지 실제로 걸린 시간.
// 화면에 기록된 시각만 쓰고, 기존 방식과의 비교값처럼 근거 없는 숫자는 만들지 않는다.
import type { LiveIncident } from './liveIncident'
import type { AnalyzedEvent } from './villageEvents'

export interface IncidentTiming {
  /** 원인 후보·고장 구간·점검 순서: 감지와 같은 계측 표본에서 냄 */
  causeMs: number
  /** FRTU 녹화 파형 AI 판정 (녹화가 없으면 null) */
  aiMs: number | null
  dispatchMs: number | null
  /** 계측상 복구 (진행 중이면 null) */
  restoreMs: number | null
  closeMs: number | null
}

const stageAt = (inc: LiveIncident, stage: LiveIncident['stage']) => inc.stageLog.find((l) => l.stage === stage)?.at ?? null
const since = (inc: LiveIncident, at: number | null) => (at == null ? null : Math.max(0, at - inc.startedAt))

export function incidentTiming(inc: LiveIncident, recorded?: AnalyzedEvent): IncidentTiming {
  return {
    causeMs: 0,
    aiMs: recorded ? since(inc, Date.parse(recorded.e.receivedAt)) : null,
    dispatchMs: since(inc, stageAt(inc, 'DISPATCHED')),
    restoreMs: since(inc, inc.clearedAt),
    closeMs: since(inc, stageAt(inc, 'CLOSED')),
  }
}

export function fmtDur(ms: number | null): string {
  if (ms == null) return '—'
  if (ms === 0) return '즉시'
  const s = ms / 1000
  if (s < 1) return '1초 미만'
  if (s < 60) return `${Math.round(s)}초`
  if (s < 3600) return `${Math.floor(s / 60)}분 ${Math.round(s % 60)}초`
  return `${Math.floor(s / 3600)}시간 ${Math.round((s % 3600) / 60)}분`
}

export const mean = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x != null)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}
