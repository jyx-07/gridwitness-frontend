import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react'
import { analyzeFrtuWave, buildFrtuWave, type FrtuWavePoint } from '../lib/frtuWave'
import { FI_LABEL, frtuViews, locateFault } from '../lib/frtu'
import { SOURCE_LABEL, STATUS_LABEL, THRESHOLDS, useVillage } from '../lib/village'
import { useVillageEvents, type AnalyzedEvent, type EventVerdict } from '../lib/villageEvents'
import { Evidence, Strip } from './FaultAnalysis'
import { IconBars, IconWave } from './Icons'
import { Segmented, Skeleton } from './ui'

const Waveform3D = lazy(() => import('./Waveform3D'))

const MAX_POINTS = 700
const fmtMa = (x: number) => `${x.toFixed(1)} mA`
const fmtPct = (x: number) => `${Math.abs(x * 100).toFixed(0)}%`

export interface FrtuVerdictInfo {
  verdict: EventVerdict
  /** 판정한 사건 이름 (예: 사건 #3 · 개폐 명령 직후) */
  title: string
  at?: string
}

/** 이상 점수 기반 규칙 판정 (AI 판정이 없을 때 같이 보여 줌) */
export interface FrtuRuleInfo {
  label: string
  lines: string[]
}

interface Props {
  points: FrtuWavePoint[]
  /** 출처 문구 (예: 실측 · INA219 2개 / 시뮬레이터) */
  sourceText: string
  verdict?: FrtuVerdictInfo | null
  rule?: FrtuRuleInfo | null
  onReview?: () => void
  /** 카드 아래에 덧붙일 버튼 등 */
  actions?: ReactNode
  /** 좁은 칸에서 한 줄로 쌓아 보여 줌 */
  stacked?: boolean
  compact?: boolean
}

/** 마을 FRTU 파형 분석: 고장파형 분석 화면과 같은 틀(파형 · 2D/3D · AI 분석 결과 · 파형 요약). 직류 계측이라 교류 3상과 섞지 않음 */
export default function FrtuWaveAnalysis({ points, sourceText, verdict, rule, onReview, actions, stacked, compact }: Props) {
  const [view, setView] = useState<'2d' | '3d'>('2d')
  const wave = useMemo(() => buildFrtuWave(points), [points])
  const features = useMemo(() => analyzeFrtuWave(wave), [wave])
  const hz = wave.dt > 0 ? 1 / wave.dt : 0

  const data = useMemo(() => {
    const step = Math.max(1, Math.ceil(wave.t.length / MAX_POINTS))
    const rows: Record<string, number | null>[] = []
    for (let i = 0; i < wave.t.length; i += step) {
      rows.push({ t: wave.t[i], 전압: wave.v[i], ...Object.fromEntries(wave.series.map((s) => [s.label, s.mA[i]])) })
    }
    return rows
  }, [wave])

  // 3D는 빈 값을 앞 값으로 채워 그림 (재지 않은 값을 새로 만들지 않고 선만 잇기 위함)
  const matrix = useMemo(() => {
    const last = wave.series.map(() => 0)
    return wave.t.map((_, i) => wave.series.map((s, k) => (last[k] = s.mA[i] ?? last[k])))
  }, [wave])

  const onset = features.onset?.seconds ?? null
  const dom = features.dominant
  const keys = wave.series.map((s) => s.label)
  const colors = wave.series.map((s) => s.color)
  const h = compact ? 118 : 158

  if (wave.t.length < 2) {
    return <div className="alert alert-warn small">아직 저장된 FRTU 계측 표본이 없어 파형을 그릴 수 없어요. 장치가 연결되면 0.5초마다 쌓여요.</div>
  }

  return (
    <div className={`fa ${compact ? 'compact' : ''}`} style={stacked ? { gridTemplateColumns: '1fr' } : undefined}>
      <div className="fa-main">
        <div className="fa-panel">
          <div className="fa-panel-head">
            <div className="row gap">
              <IconWave />
              <strong>FRTU 파형 분석</strong>
              <span className="small muted num">{wave.t.length.toLocaleString()} 샘플 · {hz ? `${hz.toFixed(hz < 10 ? 1 : 0)} Hz` : '—'} · 직류 모형 · {sourceText}</span>
            </div>
            <Segmented value={view} onChange={setView} options={[{ value: '2d', label: '2D' }, { value: '3d', label: '3D' }]} />
          </div>
          {view === '3d' ? (
            <Suspense fallback={<Skeleton h={460} style={{ borderRadius: 12 }} />}>
              <Waveform3D
                matrix={matrix}
                samplingRateHz={hz || 1}
                systemFrequencyHz={0}
                onsetSample={features.onset?.sample ?? null}
                recoverySeconds={features.recoverSeconds}
                channelNames={keys}
                channelColors={colors}
              />
            </Suspense>
          ) : (
            <>
              <Strip title="FRTU 전류" unit="mA" keys={keys} colors={colors} data={data} onset={onset} recovery={features.recoverSeconds} height={h} first />
              <Strip title="전압" unit="V" keys={['전압']} colors={['#14161b']} data={data} onset={onset} recovery={features.recoverSeconds} height={compact ? 96 : 120} last />
              {!wave.series.some((s) => s.key !== 'inlet') && <p className="hint">분기 INA219 값이 없는 기록이라 인입(마을 전체) 전류만 표시합니다.</p>}
              <div className="fa-xaxis">시간 (s)</div>
            </>
          )}
        </div>
      </div>

      <aside className="fa-side">
        <div className="fa-card">
          <div className="fa-card-head">
            <strong>AI 분석 결과</strong>
            {verdict?.verdict.kind === 'ANSWERED' && <span className="badge accent">예측 결과</span>}
            {verdict?.verdict.kind === 'WITHHELD' && <span className="badge warn">판단 보류</span>}
          </div>
          {verdict && <div className="small muted" style={{ marginBottom: 8 }}>{verdict.title}{verdict.at ? ` · ${verdict.at}` : ''}</div>}
          <VerdictBody v={verdict?.verdict ?? null} />
          {rule && (
            <div className="small" style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
              <div className="muted" style={{ marginBottom: 4 }}>규칙 판정 (이상 점수) · <b style={{ color: 'var(--ink)' }}>{rule.label}</b></div>
              <ul className="small">{rule.lines.map((l) => <li key={l}>{l}</li>)}</ul>
            </div>
          )}
          {(onReview || actions) && (
            <div className="fa-actions">
              {actions}
              {onReview && <button className="btn btn-sm btn-primary" onClick={onReview}>검토 기록</button>}
            </div>
          )}
        </div>

        <div className="fa-card">
          <div className="fa-card-head">
            <strong>파형 요약</strong>
            <span className="small muted">화면에서 직접 계산 · AI 판단과 별개</span>
          </div>
          {!features.onset ? (
            <p className="small muted">기록 안에서 뚜렷한 급변을 찾지 못했습니다. 기록 시작 전 이상 여부와 회복은 확인하지 못했습니다.</p>
          ) : (
            <div className="fa-ev-grid">
              <Evidence icon={<IconBars />} label="피크값 변화">
                {dom ? (
                  <>
                    <div className="fa-ev-sub">{dom.label} 전류</div>
                    <div className="fa-ev-val num">{fmtMa(dom.peakBefore)} → {fmtMa(dom.peakAfter)}</div>
                    <div className={`fa-ev-pct ${dom.peakPct >= 0 ? 'up' : 'down'}`}>{dom.peakPct >= 0 ? '▲' : '▼'} {fmtPct(dom.peakPct)}</div>
                  </>
                ) : <div className="small muted">전류 변화 작음</div>}
              </Evidence>
              <Evidence icon={<IconWave />} label="RMS 변화">
                {dom ? (
                  <>
                    <div className="fa-ev-sub">{dom.label} 전류</div>
                    <div className="fa-ev-val num">{fmtMa(dom.before)} → {fmtMa(dom.after)}</div>
                    <div className={`fa-ev-pct ${dom.rmsPct >= 0 ? 'up' : 'down'}`}>{dom.rmsPct >= 0 ? '▲' : '▼'} {fmtPct(dom.rmsPct)}</div>
                  </>
                ) : <div className="small muted">전류 변화 작음</div>}
              </Evidence>
              <Evidence icon={<span className="fa-clock" />} label="급변 관측 시점">
                <div className="fa-ev-val num big">{features.onset.seconds.toFixed(1)} s</div>
                <div className="small muted num">샘플 {features.onset.sample.toLocaleString()} · {wave.dt ? `${wave.dt.toFixed(1)} s 간격` : ''}</div>
              </Evidence>
              <Evidence icon={<span className="fa-dotted" />} label="특징 패턴">
                <ul className="fa-patterns">
                  {features.patterns.map((p) => <li key={p}>{p}</li>)}
                </ul>
              </Evidence>
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}

function VerdictBody({ v }: { v: EventVerdict | null }) {
  if (!v) return <p className="small muted">아직 AI가 판정한 마을 사건이 없어요. 전류가 갑자기 바뀌면 장치가 사건 파형을 녹화해 보내고, 그때 판정해요.</p>
  if (v.kind === 'REJECTED' || v.kind === 'NO_MODEL') {
    return (
      <>
        <p className="fa-withheld">{v.kind === 'NO_MODEL' ? '원인 분류 모델이 아직 학습되지 않았습니다.' : '입력 점검에서 거부된 기록이라 분석하지 않았습니다.'}</p>
        <ul className="small">{v.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
      </>
    )
  }
  const ranking = (
    <div className="scores">
      {v.ranking.map((r) => (
        <div key={r.label} className={`score ${r.label === v.label ? 'hl' : ''}`} style={{ gridTemplateColumns: '96px 1fr 40px' }}>
          <span>{r.labelKo}</span>
          <div className="bar"><div style={{ width: `${r.score * 100}%` }} /></div>
          <span className="num" style={{ textAlign: 'right' }}>{r.score.toFixed(2)}</span>
        </div>
      ))}
    </div>
  )
  return (
    <>
      {v.kind === 'ANSWERED' ? (
        <div className="fa-result">
          <div className="pred" style={{ fontSize: 30 }}>{v.labelKo}</div>
          <div className="fa-score">
            <span className="small muted">모델 점수</span>
            <strong className="num">{v.score.toFixed(2)}</strong>
          </div>
        </div>
      ) : (
        <>
          <p className="fa-withheld">결과를 내지 않았습니다. 근거가 부족한 상태에서 원인을 추정하지 않습니다.</p>
          <ul className="small" style={{ marginBottom: 10 }}>{v.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        </>
      )}
      {ranking}
      <p className="hint">보정되지 않은 점수입니다. 정답일 확률(신뢰도)이 아닙니다.</p>
      {v.evidence.length > 0 && (
        <div className="evidence" style={{ marginTop: 8 }}>
          <div className="small muted" style={{ marginBottom: 6 }}>판단 근거 (기여도 큰 순)</div>
          {v.evidence.map((e) => (
            <div key={e.name} className="evidence-row">
              <span>{e.label}</span>
              <div className="meter"><i className={e.contribution >= 0 ? 'ok' : 'err'} style={{ width: `${Math.min(100, Math.abs(e.contribution) * 300)}%` }} /></div>
              <span className="num small">{e.value.toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

/** AI가 판정한 마을 사건을 화면 문구로 */
export function verdictInfo(a: AnalyzedEvent | undefined): FrtuVerdictInfo | null {
  if (!a) return null
  return {
    verdict: a.verdict,
    title: `사건 #${a.e.ev} · ${a.e.src === 'cmd' ? '개폐 명령 직후' : '전류 급변'}`,
    at: new Date(a.e.receivedAt).toLocaleTimeString('ko-KR', { hour12: false }),
  }
}

/** 실시간 마을 FRTU 값(최근 1분)으로 그리는 파형 분석. 3D 마을·AI 도우미 옆칸에서 씀 */
export function LiveFrtuWaveAnalysis(props: Pick<Props, 'stacked' | 'compact' | 'actions'>) {
  const snap = useVillage()
  const events = useVillageEvents()
  if (!snap.connected) {
    return <div className="alert alert-warn small">장치가 연결되지 않아 지금 들어오는 FRTU 계측값이 없어요. 설정에서 장치를 다시 연결하거나 시뮬레이터로 바꿔 주세요.</div>
  }
  const views = frtuViews(snap)
  const f = views.inlet
  const loc = locateFault(snap, views)
  const rule: FrtuRuleInfo = {
    label: `${STATUS_LABEL[f.status]} · ${FI_LABEL[f.fi]}`,
    lines: [
      `인입 이상 점수 ${f.score.toFixed(2)} (주의 ${THRESHOLDS.warn} · 이상 ${THRESHOLDS.fault})`,
      `고장 구간: ${loc.title}`,
    ],
  }
  return <FrtuWaveAnalysis points={snap.history} sourceText={SOURCE_LABEL[snap.source]} verdict={verdictInfo(events[0])} rule={rule} {...props} />
}
