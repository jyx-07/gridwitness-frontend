import { useEffect, useState } from 'react'
import { eventKo } from '../lib/incidentContext'
import { loadModelCard, type ModelCard } from '../lib/aiExplain'
import type { AnalysisResult } from '../types'

// ── 출처 배지: 화면의 각 내용이 누구에게서 나왔는지 ─────────────────
export type SrcKind = 'model' | 'calc' | 'rule' | 'llm' | 'summary' | 'human'
const SRC: Record<SrcKind, { label: string; title: string }> = {
  model: { label: '모델 판정', title: '학습된 분류 모델이 계산한 이벤트 유형 점수' },
  calc: { label: '파형 계산', title: '파형에서 직접 계산한 관측값 (AI 판단과 별개)' },
  rule: { label: '규칙', title: '정해 둔 기준값과 비교한 판정' },
  llm: { label: 'LLM 설명', title: 'LLM이 위 근거를 골라 설명한 글. 판정하거나 장치를 제어하지 않음' },
  summary: { label: '근거 요약', title: '화면의 값만 이어 붙인 문장 (새 사실을 만들지 않음)' },
  human: { label: '담당자', title: '사람이 남긴 판단' },
}
export function Src({ kind }: { kind: SrcKind }) {
  return <span className={`src src-${kind}`} title={SRC[kind].title}>{SRC[kind].label}</span>
}

// ── AI 판단 4단계 띠 ─────────────────────────────────
type StepState = 'ok' | 'warn' | 'err' | 'idle'
interface Step { title: string; state: StepState; text: string }

const modelOf = (a: AnalysisResult | null): string | null => {
  if (!a) return null
  if (a.ai?.modelCountry) return `${a.ai.modelCountry} 모델${a.ai.modelDataset ? ` · ${a.ai.modelDataset}` : ''}`
  const v = a.modelVersion ?? ''
  return v ? `${v.split(':')[0]} 모델` : null
}

/** 입력 검증 → 모델 선택 → 판단 기준 → 결과. 이 사건이 어디를 통과하고 어디서 멈췄는지 */
export function AiFlow({ analysis, blocked }: { analysis: AnalysisResult | null; blocked?: boolean }) {
  const ai = analysis?.ai
  const th = ai?.thresholds
  const failed: string[] = []
  if (ai && th) {
    if (ai.topScore != null && th.score != null && ai.topScore < th.score) failed.push('점수')
    if (ai.margin != null && th.margin != null && ai.margin < th.margin) failed.push('1·2위 차')
    if (ai.oodRatio != null && th.ood_ratio != null && ai.oodRatio > th.ood_ratio) failed.push('학습 범위')
  }
  const model = modelOf(analysis)
  const steps: Step[] = [
    { title: '입력 검증', state: blocked ? 'err' : analysis ? 'ok' : 'idle', text: blocked ? '거부 · 분석 안 함' : analysis ? '형식·단위·품질 통과' : '분석 전' },
    { title: '모델 선택', state: blocked || !analysis ? 'idle' : model ? 'ok' : 'warn', text: blocked || !analysis ? '—' : model ?? '맞는 모델 없음' },
    {
      title: '판단 기준',
      state: !analysis || blocked ? 'idle' : analysis.kind === 'COMPLETED' ? 'ok' : 'warn',
      text: !analysis || blocked ? '—' : analysis.kind === 'COMPLETED' ? '점수·1·2위 차·학습 범위 통과' : failed.length ? `${failed.join('·')} 기준 미달` : '기준 미달',
    },
    {
      title: '결과',
      state: !analysis || blocked ? 'idle' : analysis.kind === 'COMPLETED' ? 'ok' : 'warn',
      text: !analysis || blocked ? '—' : analysis.kind === 'COMPLETED' ? eventKo(analysis.predictedLabel) : '판단 보류 (결론 안 냄)',
    },
  ]
  return (
    <div className="aiflow">
      <ol>
        {steps.map((s, i) => (
          <li key={s.title} className={s.state}>
            <span className="aiflow-n">{s.state === 'ok' ? '✓' : s.state === 'warn' ? '!' : s.state === 'err' ? '×' : i + 1}</span>
            <div>
              <b>{s.title}</b>
              <span>{s.text}</span>
            </div>
          </li>
        ))}
      </ol>
      <p className="aiflow-note">모델은 파형의 <b>이벤트 유형</b>만 정해요. 설비의 물리적 원인·고장 위치는 확정하지 않고, LLM은 이 근거를 설명만 해요.</p>
    </div>
  )
}

// ── 보류 기준 게이지 ─────────────────────────────────
/** 값과 기준선을 한 막대에. higherIsBetter=false면 기준보다 낮아야 통과 */
export function Gauge({ label, value, limit, higherIsBetter = true, max = 1, fmt = (x: number) => x.toFixed(2), note }: {
  label: string
  value: number
  limit: number
  higherIsBetter?: boolean
  max?: number
  fmt?: (x: number) => string
  note: string
}) {
  const pass = higherIsBetter ? value >= limit : value <= limit
  const pos = (x: number) => `${Math.max(0, Math.min(100, (x / max) * 100))}%`
  return (
    <div className="gauge">
      <div className="gauge-top">
        <span>{label} <small>{note}</small></span>
        <b className={pass ? 'ok' : 'bad'}>{fmt(value)} <small>{pass ? '통과' : '미달'}</small></b>
      </div>
      <div className="gauge-track">
        <i className={pass ? 'ok' : 'bad'} style={{ width: pos(value) }} />
        <em style={{ left: pos(limit) }} title={`기준 ${fmt(limit)}`} />
      </div>
      <div className="gauge-foot">기준 {higherIsBetter ? '≥' : '≤'} {fmt(limit)}</div>
    </div>
  )
}

// ── 모델 한눈 카드 ─────────────────────────────────
const pct = (x: number) => `${(x * 100).toFixed(1)}%`

/** 이 AI가 무엇을 배웠고 얼마나 맞히며, 무엇은 하지 않는지 한 장으로 */
export function ModelGlance() {
  const [card, setCard] = useState<ModelCard | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => { loadModelCard().then(setCard, () => setError(true)) }, [])
  if (error) return null
  if (!card) return <div className="mg mg-loading" />
  const s = card.test_selective
  const answered = s.n - s.abstained
  return (
    <div className="mg">
      <div className="mg-head">
        <strong>이 AI가 배운 것</strong>
        <Src kind="model" />
      </div>
      <div className="mg-grid">
        <div>
          <span className="mg-k">학습 데이터</span>
          <b>{card.model.dataset.title.split(' (')[0]}</b>
          <span className="mg-s">공개 고장파형 {card.data.n}건 · 7채널 · 4,096Hz · 50Hz 계통</span>
        </div>
        <div>
          <span className="mg-k">구분하는 유형</span>
          <ul className="mg-labels">
            {Object.entries(card.data.class_counts).map(([k, n]) => <li key={k}><b>{k}</b> {eventKo(k).replace(` (${k})`, '')} <span>{n}건</span></li>)}
          </ul>
        </div>
        <div>
          <span className="mg-k">시험 성적 (학습에 안 쓴 {s.n}건)</span>
          <b className="mg-big">{pct(s.selective_accuracy)}</b>
          <span className="mg-s">답한 {answered}건 기준 정확도 · 모르면 보류 {s.abstained}건</span>
        </div>
        <div>
          <span className="mg-k">하지 않는 것</span>
          <ul className="mg-no">
            <li>설비의 물리적 원인 확정</li>
            <li>고장 위치 확정</li>
            <li>점수를 정답 확률로 표시</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
