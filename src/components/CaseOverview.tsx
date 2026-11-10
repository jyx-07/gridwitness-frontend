import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import type { ApprovalStatus } from '../lib/approval'
import { inspectionCandidate } from '../lib/gis'
import type { LiveIncident } from '../lib/liveIncident'
import type { CaseSummary, Review } from '../types'

const DAY = 86_400_000
const WEEK = 7 * DAY
/** 일치율을 보려고 상세를 불러오는 검토된 사건 수 상한 (서버 부담을 줄이려고) */
const AGREE_SAMPLE = 30

const dur = (ms: number) => {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}초`
  if (s < 3600) return `${Math.floor(s / 60)}분 ${s % 60}초`
  return `${Math.floor(s / 3600)}시간 ${Math.round((s % 3600) / 60)}분`
}
const ago = (ms: number) => {
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${Math.max(1, m)}분 전`
  if (m < 1440) return `${Math.round(m / 60)}시간 전`
  return `${Math.round(m / 1440)}일 전`
}

/** 사건 기록 상단 현황판: 최근 7일 사건 · 처리 대기 · 평균 복구 시간 · AI와 사람 판단 일치율 */
export function CaseKpis({ cases, statusOf, incidents }: { cases: CaseSummary[] | null; statusOf: (c: CaseSummary) => ApprovalStatus; incidents: LiveIncident[] }) {
  const now = Date.now()
  const week = cases?.filter((c) => now - Date.parse(c.createdAt) < WEEK).length ?? 0
  const prevWeek = cases?.filter((c) => { const a = now - Date.parse(c.createdAt); return a >= WEEK && a < 2 * WEEK }).length ?? 0
  const waitReview = cases?.filter((c) => statusOf(c) === 'NEEDS_REVIEW').length ?? 0
  const waitApproval = cases?.filter((c) => statusOf(c) === 'PENDING_APPROVAL').length ?? 0
  const rejected = cases?.filter((c) => statusOf(c) === 'REJECTED').length ?? 0

  const recovered = incidents.filter((x) => x.clearedAt && now - x.startedAt < 30 * DAY)
  const ongoing = incidents.filter((x) => !x.clearedAt).length
  const avgRecover = recovered.length ? recovered.reduce((a, x) => a + (x.clearedAt! - x.startedAt), 0) / recovered.length : null

  // 검토가 끝난 사건의 마지막 검토가 AI 결과에 동의했는지
  const reviewedIds = useMemo(() => (cases ?? []).filter((c) => c.stage === 'REVIEWED').slice(0, AGREE_SAMPLE).map((c) => c.id), [cases])
  const [agree, setAgree] = useState<{ yes: number; no: number } | null>(null)
  const key = reviewedIds.join(',')
  useEffect(() => {
    if (!key) { setAgree({ yes: 0, no: 0 }); return }
    let alive = true
    Promise.allSettled(key.split(',').map((id) => api.getCase(id))).then((rs) => {
      if (!alive) return
      let yes = 0
      let no = 0
      for (const r of rs) {
        if (r.status !== 'fulfilled') continue
        const last = r.value.reviews[r.value.reviews.length - 1] as Review | undefined
        if (last?.verdict === 'AGREE') yes++
        else if (last?.verdict === 'DISAGREE') no++
      }
      setAgree({ yes, no })
    })
    return () => { alive = false }
  }, [key])
  const judged = agree ? agree.yes + agree.no : 0

  return (
    <div className="kpi-row case-kpis">
      <div className="kpi">
        <div className="kpi-top">최근 7일 사건</div>
        <div className="kpi-value">{cases ? <>{week}<small>건</small></> : '—'}</div>
        <span className="kpi-chip">{!cases ? '사건 목록을 불러오면 표시' : (week === prevWeek ? '지난주와 같음' : `지난주 ${prevWeek}건 대비 ${week > prevWeek ? '▲' : '▼'}${Math.abs(week - prevWeek)}`) }</span>
      </div>
      <div className={`kpi ${waitReview + waitApproval + rejected > 0 ? 'warn' : ''}`}>
        <div className="kpi-top">처리 대기</div>
        <div className="kpi-value">{cases ? <>{waitReview + waitApproval + rejected}<small>건</small></> : '—'}</div>
        <span className="kpi-chip">{!cases ? '사건 목록을 불러오면 표시' : <>검토 {waitReview} · 승인 {waitApproval}{rejected ? ` · 반려 ${rejected}` : ''}</>}</span>
      </div>
      <div className="kpi">
        <div className="kpi-top">평균 복구 시간</div>
        <div className="kpi-value small">{avgRecover != null ? dur(avgRecover) : '—'}</div>
        <span className="kpi-chip">최근 30일 복구 {recovered.length}건{ongoing ? ` · 진행 중 ${ongoing}` : ''}</span>
      </div>
      <div className="kpi">
        <div className="kpi-top">AI·담당자 판단 일치</div>
        <div className="kpi-value">{!cases ? '—' : !agree ? '…' : judged ? <>{Math.round((agree.yes / judged) * 100)}<small>%</small></> : '—'}</div>
        <span className="kpi-chip">{!cases ? '사건 목록을 불러오면 표시' : !agree ? '검토 기록 확인 중' : judged ? `검토 ${judged}건 중 동의 ${agree.yes}` : '동의·반대로 검토된 사건 없음'}</span>
      </div>
    </div>
  )
}

const CAUSE_OF = (x: LiveIncident) => x.cause.split(' — ')[0]
const PLACE_OF = (x: LiveIncident) => inspectionCandidate(x.scope)?.section.split(' (')[0] ?? '구간 미확정'

/** 반복 고장 구간: 최근 7일 같은 구간·같은 원인이 2번 넘게 난 곳 */
export function RepeatFaults({ incidents }: { incidents: LiveIncident[] }) {
  const now = Date.now()
  const groups = useMemo(() => {
    const at = Date.now()
    const map = new Map<string, LiveIncident[]>()
    for (const x of incidents) {
      if (at - x.startedAt > WEEK || ['NONE', 'OFF', 'NO_DATA'].includes(x.scope)) continue
      const k = `${x.scope}|${CAUSE_OF(x)}`
      map.set(k, [...(map.get(k) ?? []), x])
    }
    return [...map.values()]
      .filter((g) => g.length >= 2)
      .map((g) => g.sort((a, b) => b.startedAt - a.startedAt))
      .sort((a, b) => b.length - a.length || b[0].startedAt - a[0].startedAt)
  }, [incidents])

  return (
    <div className="rf">
      <div className="rf-head">
        <strong>반복 고장 구간</strong>
        <span className="small muted">최근 7일 · 같은 구간에서 같은 원인이 2번 이상</span>
      </div>
      {groups.length === 0 ? (
        <p className="small muted" style={{ margin: 0 }}>최근 7일 동안 반복된 고장 구간이 없어요.</p>
      ) : (
        <ul className="rf-list">
          {groups.slice(0, 4).map((g) => {
            const last = g[0]
            const total = g.reduce((a, x) => a + ((x.clearedAt ?? now) - x.startedAt), 0)
            return (
              <li key={`${last.scope}|${CAUSE_OF(last)}`} className={g.length >= 3 ? 'hot' : ''}>
                <div className="rf-main">
                  <div><b>{PLACE_OF(last)}</b> · {CAUSE_OF(last)}</div>
                  <div className="xs muted">마지막 {ago(now - last.startedAt)} · 누적 고장 {dur(total)}{g.length >= 3 ? ' · 근본 원인 점검 권장' : ''}</div>
                </div>
                {/* 7일 막대 위에 사건 위치를 점으로 */}
                <div className="rf-track" aria-label={`최근 7일 ${g.length}회`}>
                  {g.map((x) => <i key={x.recordId} style={{ left: `${100 - ((now - x.startedAt) / WEEK) * 100}%` }} />)}
                </div>
                <span className="rf-count num">{g.length}회</span>
                <Link to={`/incidents/${last.recordId}`} className="btn btn-sm">최근 사건</Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
