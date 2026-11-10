import { useEffect, useState } from 'react'
import type { ApprovalStatus } from '../lib/approval'
import { loadModelCard, type ModelCard } from '../lib/aiExplain'
import { eventKo } from '../lib/incidentContext'
import { EVENT_MODEL } from '../lib/villageEvents'
import type { CaseSummary } from '../types'

/** 사람이 확정한 사건이 다음 학습 데이터가 되는 흐름: 등록 → 검토 → 최종 승인 → 학습 후보, 그리고 지금 모델의 유형별 학습량 */
export default function DataFlywheel({ cases, statusOf }: { cases: CaseSummary[] | null; statusOf: (c: CaseSummary) => ApprovalStatus }) {
  const [card, setCard] = useState<ModelCard | null>(null)
  useEffect(() => { loadModelCard().then(setCard, () => setCard(null)) }, [])

  const total = cases?.length ?? null
  const reviewed = cases?.filter((c) => c.stage === 'REVIEWED').length ?? null
  const approved = cases?.filter((c) => statusOf(c) === 'APPROVED') ?? null
  const steps = [
    { label: '등록된 사건', n: total, sub: '자동·수동 등록' },
    { label: '담당자 검토', n: reviewed, sub: 'AI 결과에 사람 판단' },
    { label: '최종 승인 (2인)', n: approved?.length ?? null, sub: '다른 사람이 확정' },
    { label: '학습 후보', n: approved?.length ?? null, sub: `고장파형 ${approved?.filter((c) => c.caseType === 'WAVEFORM').length ?? '—'} · 마을 ${approved?.filter((c) => c.caseType === 'IOT').length ?? '—'}`, key: true },
  ]

  // 지금 모델이 유형별로 몇 건을 배웠는지 (적은 유형 = 확정 사건이 가장 필요한 곳)
  const groups: { title: string; counts: Record<string, number>; ko: (k: string) => string }[] = []
  if (card) groups.push({ title: `고장파형 모델 (${card.model.dataset.title.split(' (')[0]})`, counts: card.data.class_counts, ko: (k) => eventKo(k).replace(` (${k})`, '') })
  if (EVENT_MODEL.data?.counts) groups.push({ title: '마을 FRTU 모델 (우노 실측)', counts: EVENT_MODEL.data.counts, ko: (k) => EVENT_MODEL.label_ko[k] ?? k })

  return (
    <div className="fw">
      <div className="fw-head">
        <strong>쓸수록 쌓이는 학습 데이터</strong>
        <span className="small muted">사람이 확정한 사건만 다음 학습에 써요</span>
      </div>
      <ol className="fw-steps">
        {steps.map((s) => (
          <li key={s.label} className={s.key ? 'key' : ''}>
            <span>{s.label}</span>
            <b className="num">{s.n ?? '—'}</b>
            <small>{s.n == null ? '사건 목록을 불러오면 표시' : s.sub}</small>
          </li>
        ))}
      </ol>
      <div className="fw-models">
        {groups.map((g) => {
          const entries = Object.entries(g.counts)
          const max = Math.max(...entries.map(([, n]) => n), 1)
          const min = Math.min(...entries.map(([, n]) => n))
          return (
            <div key={g.title}>
              <div className="small muted" style={{ marginBottom: 6 }}>{g.title} · 유형별 학습 건수</div>
              {entries.map(([k, n]) => (
                <div key={k} className={`fw-bar ${n === min ? 'low' : ''}`}>
                  <span>{g.ko(k)}</span>
                  <div><i style={{ width: `${(n / max) * 100}%` }} /></div>
                  <b className="num">{n}</b>
                </div>
              ))}
              <div className="xs muted" style={{ marginTop: 4 }}>가장 적은 유형: <b>{g.ko(entries.find(([, n]) => n === min)?.[0] ?? '')}</b> — 이 유형의 확정 사건이 가장 필요해요</div>
            </div>
          )
        })}
      </div>
      <p className="xs muted" style={{ margin: '10px 0 0' }}>재학습은 자동으로 일어나지 않아요. 확정 사건을 모아 학습 스크립트로 다시 학습하고, 성능을 확인한 뒤에만 모델을 바꿔요.</p>
    </div>
  )
}
