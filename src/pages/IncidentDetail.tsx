import { Link, useParams } from 'react-router-dom'
import { getVillageRecordState, retryVillageRecords, useVillagePersistence } from '../api/village'
import FrtuWaveAnalysis, { similarOf, verdictInfo } from '../components/FrtuWaveAnalysis'
import { findRecorded, IncidentTrail, StageBar } from '../components/LiveIncident'
import FiCheckBox from '../components/FiCheckBox'
import ResponseTiming from '../components/ResponseTiming'
import { fiCrossCheck } from '../lib/fiCheck'
import { Badge, Empty, PageHeader } from '../components/ui'
import { FRTUS } from '../lib/frtu'
import { FI_SHORT, useLiveIncidents } from '../lib/liveIncident'
import { askAssistantVillage } from '../lib/panels'
import type { EventVerdict } from '../lib/villageEvents'
import { useVillageEvents } from '../lib/villageEvents'

const secs = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}초` : `${Math.floor(s / 60)}분 ${s % 60}초`
}

// 규칙 판정 문구와 AI 판정 라벨이 같은 원인을 가리키는지 (단어가 겹칠 때만 '같음'으로 봄, 억지로 맞추지 않음)
const RULE_KEY: [RegExp, string][] = [
  [/단선/, 'PERMANENT'],
  [/순간/, 'MOMENTARY'],
  [/접촉|반복/, 'INTERMITTENT'],
  [/개폐|명령/, 'SWITCH'],
  [/재접속|복구/, 'RECONNECT'],
]
function compare(cause: string, v: EventVerdict | undefined): { tone: 'ok' | 'warn' | 'neutral'; text: string } {
  if (!v) return { tone: 'neutral', text: '이 사건에는 FRTU가 녹화한 사건 파형이 없어 AI 판정 없이 계측값 규칙 판정만 있어요.' }
  if (v.kind === 'NO_MODEL' || v.kind === 'REJECTED') return { tone: 'neutral', text: 'AI 판정을 내지 못해 계측값 규칙 판정 기준으로 점검해요.' }
  if (v.kind === 'WITHHELD') return { tone: 'warn', text: `AI는 근거가 부족해 판단을 보류했어요 (1순위 후보 '${v.labelKo}'). 계측값 규칙 판정 기준으로 점검하고, 현장 확인 결과를 검토로 남겨 주세요.` }
  const key = RULE_KEY.find(([re]) => re.test(cause))?.[1]
  if (key && key === v.label) return { tone: 'ok', text: `두 판정이 같은 원인('${v.labelKo}')을 가리켜요.` }
  return { tone: 'warn', text: `두 판정이 서로 달라요. 계측값 규칙은 '${cause.split(' — ')[0]}', AI는 '${v.labelKo}'로 봤어요. 규칙은 지금 전류·전압 값을, AI는 사건 전후 전류 흐름의 모양을 보기 때문에 다를 수 있어요. 현장에서 확인한 뒤 검토로 남겨 주세요.` }
}

/** 상세 원인 분석: 실시간 사건 하나를 크게. 처리 단계 · 사건 전후 파형 · 원인 분석(규칙 / AI / FRTU별) 비교 · 권고 조치 */
export default function IncidentDetail() {
  const { id = '' } = useParams()
  const { incidents } = useLiveIncidents()
  const events = useVillageEvents()
  const persistence = useVillagePersistence()
  const inc = incidents.find((x) => x.recordId === id || String(x.id) === id)

  if (!inc) {
    return (
      <>
        <PageHeader crumbs={[{ label: '대시보드', to: '/dashboard' }, { label: '상세 원인 분석' }]} title="상세 원인 분석" />
        <Empty title="사건을 찾을 수 없어요" description="이 브라우저에 남아 있지 않거나 지워진 사건이에요. 대시보드의 오늘의 실시간 사건에서 다시 열어 주세요." action={<Link to="/dashboard" className="btn">대시보드로</Link>} />
      </>
    )
  }

  const live = !inc.clearedAt
  const recorded = findRecorded(inc, events)
  const v = recorded?.verdict
  const cmp = compare(inc.cause, v)
  const fiCheck = fiCrossCheck(inc, recorded)
  const stored = getVillageRecordState(inc.recordId)
  const points = inc.points.map((p) => ({ ...p, v: Number.NaN }))

  return (
    <>
      <PageHeader
        crumbs={[{ label: '대시보드', to: '/dashboard' }, { label: '상세 원인 분석' }]}
        title={inc.title}
        meta={
          <>
            <span className="mono">실시간 사건 #{inc.id}</span>
            <Badge outline>{inc.source === 'MOCK' ? '시뮬레이터' : '실측'} · 마을 직류 계측</Badge>
            <Badge tone={live ? 'err' : 'ok'}>{live ? `진행 중 · ${secs(Date.now() - inc.startedAt)}` : `복구됨 · ${secs(inc.clearedAt! - inc.startedAt)} 만에`}</Badge>
          </>
        }
        actions={
          <>
            {inc.caseId && <Link to={`/cases/${inc.caseId}`} className="btn">사건 기록 보기</Link>}
            <Link to={`/report/live/${inc.recordId}`} className="btn">보고서</Link>
            <button type="button" className="btn btn-primary" onClick={askAssistantVillage}>AI에게 묻기</button>
          </>
        }
      />

      <StageBar inc={inc} />
      <ResponseTiming inc={inc} recorded={recorded} />
      <div className="small muted" style={{ margin: '8px 0 14px' }}>
        이 사건: {stored === 'server' ? '서버 보존 완료' : stored === 'pending' ? '브라우저 보존 · 서버 전송 대기' : '브라우저 저장 실패 · 이 탭에서만 유지'} · 마을 전체 전송 대기 {persistence.pending}건{' '}
        <button type="button" className="chat-link" disabled={persistence.syncing} onClick={() => { void retryVillageRecords() }}>저장 재시도</button>
      </div>

      {/* FRTU 파형 분석과 같은 틀: 파형(2D/3D) · 평소 vs 지금 · 파형 요약 · 경과·단선도 | 판정 비교 · AI 진단 보고서 */}
      <FrtuWaveAnalysis
        points={points}
        sourceText={inc.source === 'MOCK' ? '시뮬레이터' : '실측'}
        verdict={verdictInfo(recorded)}
        similar={similarOf(events, recorded)}
        rule={{ label: inc.cause, lines: inc.reasons }}
        location={{ scope: inc.scope, title: inc.title }}
        compareAt={{ at: inc.startedAt, label: '고장표시 발생' }}
        extraMain={
          <div className="fa-card" style={{ marginTop: 14 }}>
            <div className="fa-card-head"><strong>사건 경과 · 고장 구간</strong></div>
            <IncidentTrail inc={inc} recorded={recorded} />
          </div>
        }
        extraSide={
          <div className="fa-card">
            <FiCheckBox check={fiCheck} />
            <div className="fa-card-head" style={{ marginTop: 12 }}>
              <strong>판정 비교</strong>
              <Badge tone={cmp.tone === 'ok' ? 'ok' : cmp.tone === 'warn' ? 'warn' : 'neutral'}>{cmp.tone === 'ok' ? '판정 일치' : cmp.tone === 'warn' ? '확인 필요' : '규칙 판정만'}</Badge>
            </div>
            <div className="small muted" style={{ marginBottom: 6 }}>FRTU별 고장표시</div>
            <div className="is-fi" style={{ marginBottom: 10 }}>
              {FRTUS.map((f) => (
                <div key={f.id} className={inc.fi[f.id] !== 'NONE' ? 'hit' : ''}>
                  <span>{f.short}</span>
                  <b>{FI_SHORT[inc.fi[f.id]]}</b>
                </div>
              ))}
            </div>
            <div className={`alert ${cmp.tone === 'ok' ? 'alert-ok' : cmp.tone === 'warn' ? 'alert-warn' : 'alert-info'} small`} style={{ margin: 0 }}>
              <span>계측값 규칙 <b>{inc.cause.split(' — ')[0]}</b> · {cmp.text}</span>
            </div>
          </div>
        }
      />
      <p className="xs muted" style={{ marginTop: 10 }}>직류 모형 계측 · 전류만 기록 (실제 현장은 교류 고장파형)</p>
    </>
  )
}
