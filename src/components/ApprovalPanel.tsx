import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { api } from '../api'
import { fmtTime, getActor } from '../lib/actor'
import { APPROVAL_LABEL, APPROVAL_TONE, approvalLog, approvalStatus, approveCase, cannotApprove, noteReviewAdded, rejectCase, useApprovals, type ApprovalEntry } from '../lib/approval'
import { VERDICT_LABEL, type AnyCase, type Review } from '../types'
import { Badge, Section, Segmented } from './ui'

const STEPS = ['등록', '분석', '담당자 검토', '최종 승인', '확정'] as const

/** 사건 상태 배지 (확정 / 승인 대기 / 반려 …) */
export function ApprovalBadge({ c }: { c: AnyCase }) {
  const s = useApprovals()
  const status = approvalStatus(c, approvalLog(s, c.id))
  return <Badge tone={APPROVAL_TONE[status]}>{APPROVAL_LABEL[status]}</Badge>
}

/** 진행 이력: 검토와 승인·반려를 시간순으로 한 줄에 */
function FlowHistory({ c, log }: { c: AnyCase; log: ApprovalEntry[] }) {
  const rows = [
    ...c.reviews.map((r) => ({ at: r.reviewedAt, title: `검토 · ${VERDICT_LABEL[r.verdict]}`, by: r.reviewer, lines: [r.finalJudgment && `판단한 원인: ${r.finalJudgment}`, r.additionalInvestigation && `추가 조사: ${r.additionalInvestigation}`] })),
    ...log.map((e, i) => ({
      at: e.at,
      title: e.decision === 'APPROVED' ? '승인 · 확정' : e.decision === 'RESUBMITTED' ? '검토 다시 제출' : log[i - 1]?.decision === 'APPROVED' ? '재검토 요청' : '반려',
      by: e.by,
      lines: [e.finalCause && `최종 원인: ${e.finalCause}`, e.comment],
    })),
  ].sort((a, b) => a.at.localeCompare(b.at))
  if (!rows.length) return <p className="small muted">아직 검토·승인 기록이 없어요.</p>
  return (
    <ol className="timeline">
      {rows.map((r, i) => (
        <li key={i}>
          <time>{fmtTime(r.at)}</time>
          <div>
            <strong className="strong">{r.title}</strong> <span className="muted small">{r.by}</span>
            {r.lines.filter(Boolean).map((l) => <div key={l as string} className="small muted">{l}</div>)}
          </div>
        </li>
      ))}
    </ol>
  )
}

/**
 * 검토 · 승인: 한 칸에서 단계대로 진행. 지금 단계의 양식만 보여 줌
 * 담당자 검토 → (검토자와 다른 사람) 최종 승인 → 확정. 확정 뒤에는 재검토 요청으로만 다시 열림
 */
export default function ReviewFlow({ c, onChange, locked }: { c: AnyCase; onChange: (c: AnyCase) => void; /** 검토를 막는 이유 (예: 원본 CSV 없음) */ locked?: ReactNode }) {
  const s = useApprovals()
  const log = approvalLog(s, c.id)
  const status = approvalStatus(c, log)
  const latest = c.reviews[c.reviews.length - 1] as Review | undefined
  const lastEntry = log[log.length - 1]
  const stepAt = status === 'APPROVED' ? 5 : status === 'PENDING_APPROVAL' ? 3 : c.stage === 'REGISTERED' || c.stage === 'DIAGNOSED' ? 1 : 2

  // 검토 양식
  const [reviewer, setReviewer] = useState(getActor)
  const [verdict, setVerdict] = useState<Review['verdict']>('AGREE')
  const [judgment, setJudgment] = useState('')
  const [investigation, setInvestigation] = useState('')
  // 승인 양식
  const [approver, setApprover] = useState('')
  const [cause, setCause] = useState(latest?.finalJudgment ?? '')
  const [comment, setComment] = useState('')
  const [reopen, setReopen] = useState(false)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { setCause(latest?.finalJudgment ?? ''); setError(null) }, [latest?.reviewedAt]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setError(null); setComment(''); setReopen(false) }, [status])
  const blocked = cannotApprove(c, log, approver)

  async function submitReview(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!reviewer.trim()) return setError('검토자 이름을 적어 주세요.')
    if (!judgment.trim()) return setError('판단한 원인을 적어 주세요.')
    if (verdict === 'NEEDS_INVESTIGATION' && !investigation.trim()) return setError('어떤 조사가 더 필요한지 적어 주세요.')
    setBusy(true)
    try {
      onChange(await api.submitReview(c.id, { reviewer: reviewer.trim(), verdict, finalJudgment: judgment.trim(), additionalInvestigation: verdict === 'NEEDS_INVESTIGATION' ? investigation.trim() : '' }))
      noteReviewAdded(c.id, reviewer.trim())
      setJudgment('')
      setInvestigation('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function approve() {
    setError(null)
    if (blocked) return setError(blocked)
    if (!cause.trim()) return setError('확정할 최종 원인을 적어 주세요.')
    approveCase(c.id, approver, cause, comment)
  }
  function reject(kind: '반려' | '재검토 요청') {
    setError(null)
    if (!approver.trim()) return setError('이름을 적어 주세요.')
    if (!comment.trim()) return setError(`${kind} 사유를 적어 주세요.`)
    rejectCase(c.id, approver, comment)
  }

  const reviewNote =
    status === 'REJECTED' ? `${lastEntry?.by}님이 ${log[log.length - 2]?.decision === 'APPROVED' ? '재검토를 요청' : '반려'}했어요: "${lastEntry?.comment}". 확인한 뒤 검토를 다시 남겨 주세요.`
      : status === 'INVESTIGATING' ? `추가 조사가 필요하다고 검토됐어요 (${latest?.additionalInvestigation}). 조사를 마친 뒤 결과를 반영해 다시 검토해 주세요.`
        : null

  return (
    <Section
      title="검토 · 승인"
      description="담당자가 검토하고, 검토한 사람과 다른 사람이 최종 승인해야 사건이 확정돼요. 확정된 사건만 사고 기록과 AI 학습 데이터로 써요."
      actions={<Badge tone={APPROVAL_TONE[status]}>{APPROVAL_LABEL[status]}</Badge>}
    >
      <ol style={{ display: 'flex', gap: 6, listStyle: 'none', padding: 0, margin: '0 0 16px', flexWrap: 'wrap' }}>
        {STEPS.map((label, k) => (
          <li key={label} style={{ flex: '1 1 0', minWidth: 90, padding: '8px 10px', borderRadius: 10, fontSize: 13, fontWeight: 600, background: k < stepAt ? 'var(--ok-tint)' : k === stepAt ? 'var(--accent-tint)' : 'var(--fill)', color: k < stepAt ? '#135c34' : k === stepAt ? '#22398f' : 'var(--muted)' }}>
            <span className="num" style={{ marginRight: 6, opacity: 0.7 }}>{k < stepAt ? '✓' : k + 1}</span>{label}
          </li>
        ))}
      </ol>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24, alignItems: 'start' }}>
        <div>
          {status === 'APPROVED' && lastEntry ? (
            <>
              <h3 style={{ marginTop: 0 }}>확정된 사건</h3>
              <div className="alert alert-ok" style={{ margin: '0 0 12px' }}>
                <span>
                  최종 원인: <strong>{lastEntry.finalCause}</strong>
                  <br />검토 {latest?.reviewer ?? '—'} → 승인 {lastEntry.by} · {fmtTime(lastEntry.at)}{lastEntry.comment ? ` · ${lastEntry.comment}` : ''}
                </span>
              </div>
              {!reopen ? (
                <button type="button" className="btn btn-sm no-print" onClick={() => setReopen(true)}>재검토 요청</button>
              ) : (
                <div className="form no-print">
                  <label className="field">요청자<input value={approver} onChange={(e) => setApprover(e.target.value)} placeholder="이름" /></label>
                  <label className="field">재검토 요청 사유<textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="확정된 원인을 다시 봐야 하는 이유" /></label>
                  {error && <div className="alert alert-err small" style={{ margin: 0 }}>{error}</div>}
                  <div className="row gap">
                    <button type="button" className="btn btn-primary" onClick={() => reject('재검토 요청')}>재검토 요청</button>
                    <button type="button" className="btn btn-ghost" onClick={() => setReopen(false)}>취소</button>
                  </div>
                </div>
              )}
            </>
          ) : status === 'PENDING_APPROVAL' && latest ? (
            <>
              <h3 style={{ marginTop: 0 }}>최종 승인</h3>
              <div className="review-item" style={{ marginBottom: 12 }}>
                <div className="small muted">검토 결과 · {latest.reviewer} · {fmtTime(latest.reviewedAt)}</div>
                <div style={{ marginTop: 4 }}><Badge>{VERDICT_LABEL[latest.verdict]}</Badge></div>
                <div className="small" style={{ marginTop: 6 }}>판단한 원인: <b>{latest.finalJudgment || '—'}</b></div>
              </div>
              <div className="form no-print">
                <label className="field">승인자 <span className="field-hint">검토한 사람({latest.reviewer})과 다른 사람</span><input value={approver} onChange={(e) => setApprover(e.target.value)} placeholder="이름" /></label>
                <label className="field">최종 원인 <span className="field-hint">검토 결과를 그대로 쓰거나 고쳐서 확정</span><textarea rows={2} value={cause} onChange={(e) => setCause(e.target.value)} /></label>
                <label className="field">의견 <span className="field-hint">반려할 때는 사유 필수</span><textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} /></label>
                {approver.trim() && blocked && <div className="alert alert-warn small" style={{ margin: 0 }}>{blocked}</div>}
                {error && <div className="alert alert-err small" style={{ margin: 0 }}>{error}</div>}
                <div className="row gap">
                  <button type="button" className="btn btn-primary" onClick={approve} disabled={!approver.trim() || !!blocked}>승인하고 확정</button>
                  <button type="button" className="btn" onClick={() => reject('반려')}>반려</button>
                </div>
              </div>
            </>
          ) : locked ? (
            <>
              <h3 style={{ marginTop: 0 }}>담당자 검토</h3>
              <div className="alert alert-warn" style={{ margin: 0 }}><span>{locked}</span></div>
            </>
          ) : (
            <>
              <h3 style={{ marginTop: 0 }}>담당자 검토</h3>
              {reviewNote && <div className="alert alert-warn small" style={{ margin: '0 0 12px' }}><span>{reviewNote}</span></div>}
              <form className="form no-print" onSubmit={submitReview}>
                <label className="field">검토자<input value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="이름" /></label>
                <div className="field">
                  AI 결과를 어떻게 보나요?
                  <Segmented value={verdict} onChange={setVerdict} options={(Object.keys(VERDICT_LABEL) as Review['verdict'][]).map((v) => ({ value: v, label: VERDICT_LABEL[v] }))} />
                </div>
                <label className="field">판단한 원인 <span className="field-hint">AI 결과와 별개로 담당자가 본 원인</span><textarea rows={2} value={judgment} onChange={(e) => setJudgment(e.target.value)} placeholder="예: 주택 1 인입선 접속 불량으로 인한 단선" /></label>
                {verdict === 'NEEDS_INVESTIGATION' && (
                  <label className="field">더 필요한 조사<textarea rows={2} value={investigation} onChange={(e) => setInvestigation(e.target.value)} placeholder="현장 조사, 설비 이력 확인 등" /></label>
                )}
                {error && <div className="alert alert-err small" style={{ margin: 0 }}>{error}</div>}
                <div className="row gap">
                  <button className="btn btn-primary" disabled={busy}>{busy ? '저장 중…' : verdict === 'NEEDS_INVESTIGATION' ? '검토 저장 (추가 조사)' : '검토 저장하고 승인 요청'}</button>
                </div>
              </form>
            </>
          )}
        </div>

        <div>
          <h3 style={{ marginTop: 0 }}>진행 이력</h3>
          <FlowHistory c={c} log={log} />
        </div>
      </div>
    </Section>
  )
}
