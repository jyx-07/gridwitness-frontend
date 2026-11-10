import type { ReactNode } from 'react'
import { fmtTime } from '../lib/actor'
import { approvalLog, approvalStatus, useApprovals } from '../lib/approval'
import ReviewFlow from './ApprovalPanel'
import { VERDICT_LABEL, type AnyCase, type Review } from '../types'
import { Badge, Section } from './ui'

const VERDICT_TONE: Record<Review['verdict'], 'ok' | 'warn' | 'accent'> = { AGREE: 'ok', DISAGREE: 'warn', NEEDS_INVESTIGATION: 'accent' }

/** 사람 검토 — 위에는 AI 결과 / 담당자 판단 / 확정 원인을 나란히, 아래에서 검토·승인을 단계대로 진행 (사건 유형 공통) */
export default function ReviewPanel({ c, aiSummary, onChange, locked }: { c: AnyCase; aiSummary: ReactNode; onChange: (c: AnyCase) => void; /** 검토를 막는 이유 */ locked?: ReactNode }) {
  const latest = c.reviews[c.reviews.length - 1]
  const approvals = useApprovals()
  const log = approvalLog(approvals, c.id)
  const approved = approvalStatus(c, log) === 'APPROVED' ? log[log.length - 1] : null

  return (
    <>
      <div className="review-cols">
        <div>
          <h3>AI 결과 · 원본 보존</h3>
          {aiSummary}
        </div>
        <div>
          <h3>담당자 판단</h3>
          {latest ? (
            <>
              <Badge tone={VERDICT_TONE[latest.verdict]}>{VERDICT_LABEL[latest.verdict]}</Badge>
              <div style={{ marginTop: 6 }}>{latest.finalJudgment || <span className="muted">—</span>}</div>
              <div className="xs muted num" style={{ marginTop: 4 }}>{latest.reviewer} · {fmtTime(latest.reviewedAt)}</div>
            </>
          ) : (
            <span className="muted">아직 검토 전</span>
          )}
        </div>
        <div>
          <h3>확정 원인</h3>
          {approved ? (
            <>
              <strong>{approved.finalCause}</strong>
              <div className="xs muted num" style={{ marginTop: 4 }}>승인 {approved.by} · {fmtTime(approved.at)}</div>
            </>
          ) : (
            <span className="muted">아직 확정 안 됨 · 최종 승인 필요</span>
          )}
        </div>
      </div>

      <ReviewFlow c={c} onChange={onChange} locked={locked} />

      <Section title="실행 이력" description="원본 등록부터 검토까지 이 사건에서 일어난 일">
        <ol className="timeline">
          {c.history.map((h, i) => (
            <li key={i}>
              <time>{fmtTime(h.at)}</time>
              <div>
                <strong className="strong">{h.action}</strong> <span className="muted small">{h.actor}</span>
                {h.detail && <div className="small muted">{h.detail}</div>}
              </div>
            </li>
          ))}
        </ol>
      </Section>
    </>
  )
}
