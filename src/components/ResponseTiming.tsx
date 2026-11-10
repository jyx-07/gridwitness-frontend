import { fmtDur, incidentTiming } from '../lib/incidentTiming'
import type { LiveIncident } from '../lib/liveIncident'
import type { AnalyzedEvent } from '../lib/villageEvents'

/** 이 사건이 감지된 뒤 각 단계까지 걸린 시간 (기록된 시각 기준) */
export default function ResponseTiming({ inc, recorded }: { inc: LiveIncident; recorded?: AnalyzedEvent }) {
  const t = incidentTiming(inc, recorded)
  const items: { label: string; value: string; sub: string; key?: boolean }[] = [
    { label: '원인 후보 · 점검 순서', value: fmtDur(t.causeMs), sub: '감지와 같은 0.5초 계측에서 바로', key: true },
    { label: 'AI 파형 판정', value: recorded ? fmtDur(t.aiMs) : '녹화 없음', sub: recorded ? 'FRTU 녹화 수신 → 판정' : '규칙 판정만 사용' },
    { label: '출동', value: fmtDur(t.dispatchMs), sub: t.dispatchMs == null ? '아직 출동 전' : '담당자가 출동 처리' },
    { label: '복구', value: inc.clearedAt ? fmtDur(t.restoreMs) : '진행 중', sub: '계측상 전류·전압 정상 복귀' },
  ]
  return (
    <div className="rt" aria-label="처리 시간">
      <div className="rt-head">
        <strong>감지 후 걸린 시간</strong>
        <span className="xs muted">기록된 시각 기준 · 0초 = 고장표시 발생</span>
      </div>
      <ol>
        {items.map((x) => (
          <li key={x.label} className={x.key ? 'key' : ''}>
            <span>{x.label}</span>
            <b className="num">{x.value}</b>
            <small>{x.sub}</small>
          </li>
        ))}
      </ol>
    </div>
  )
}
