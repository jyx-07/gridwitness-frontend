import { useEffect, useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { apiBase } from '../lib/backend'
import { CHART } from '../lib/chart'
import { IOT_CHANNELS, STATUS_LABEL, type VillageSnapshot } from '../lib/village'
import { useVillageEvents } from '../lib/villageEvents'
import { IconX } from './Icons'
import { NODE_TONE, Segmented, Status } from './ui'

// 3D 마을의 단말장치를 눌렀을 때 뜨는 패널.
// ① 모형 단말: 우노가 FRTU 와 같은 일(계측, 고장 감지, 고장파형 저장)을 한다. 값은 모두 실측
// ② 실제 배전 고장파형: 국내 FRTU 고장파형은 공개된 것이 없어(2026-11-09 조사) 해외 공개 실측 파형을 서버 API 로 받는다.
//    FRTU 기록이 아니라는 것을 화면에 그대로 적는다

interface RefMeta {
  id: string
  country: string
  label: string
  label_ko: string
  channels: string[]
  sampling_rate_hz: number
  system_freq_hz: number
  rows: number
  source: { title: string; url: string; license: string; note: string }
}
interface RefDetail extends RefMeta {
  waveform: number[][]
  ai: {
    status: string
    prediction: { label: string; ranking?: { label: string; score: number }[] } | null
    reasons: { code: string; message: string }[] | null
  } | null
}
interface RefList {
  selection_rule: string
  not_frtu: string
  items: RefMeta[]
}

const LABEL_KO: Record<string, string> = {
  SIF: '반주기 미만 초기 고장',
  MIF: '여러 주기 초기 고장',
  PF: '영구 고장',
  TD: '과도 외란',
  NORMAL: '정상',
  SWITCHING: '개폐 (조작)',
  ABNORMAL: '이상',
  FAULT: '고장',
}
const COLORS = ['#3157e0', '#cf3434', '#2b8a3e', '#b86400']

export default function TerminalPanel({ snap, onClose }: { snap: VillageSnapshot; onClose: () => void }) {
  const [tab, setTab] = useState<'live' | 'ref'>('live')
  return (
    <div className="scene-pop terminal-pop" role="dialog" aria-label="단말장치 상세">
      <div className="scene-pop-head">
        <strong>단말장치</strong>
        <span className="tag">FRTU 역할</span>
        <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="닫기"><IconX /></button>
      </div>
      <Segmented
        value={tab}
        onChange={(v) => setTab(v as 'live' | 'ref')}
        options={[
          { value: 'live', label: '모형 단말 (실측)' },
          { value: 'ref', label: '실제 고장파형 (해외)' },
        ]}
      />
      <div style={{ marginTop: 12 }}>{tab === 'live' ? <Live snap={snap} /> : <Reference />}</div>
    </div>
  )
}

function Live({ snap }: { snap: VillageSnapshot }) {
  const events = useVillageEvents()
  const last = events[0]
  const data = useMemo(
    () => (last ? last.e.i100.map((v, k) => ({ t: (k - last.e.pre) * last.e.dtMs, mA: v / 100 })) : []),
    [last],
  )
  const live = snap.connected && snap.source === 'SERIAL'
  return (
    <>
      <p className="hint" style={{ marginTop: 0 }}>
        실제 FRTU처럼 이 모형의 우노가 전류를 계속 재고, 이상을 감지하고, 사건 앞뒤 2.6초 파형을 저장합니다. 아래 값은 모두 우노 실측입니다.
      </p>
      <Status tone={NODE_TONE[snap.status]}>{live ? STATUS_LABEL[snap.status] : '장치 연결 안 됨 (실측 값 없음)'}</Status>
      {live && (
        <dl className="kv" style={{ marginTop: 12 }}>
          <div><dt>전압</dt><dd className="num">{snap.v.toFixed(2)} V</dd></div>
          <div><dt>전류</dt><dd className="num">{(snap.i * 1000).toFixed(1)} mA</dd></div>
          <div><dt>마을 전원</dt><dd>{snap.relay ? '들어옴' : '끊김'}</dd></div>
          <div><dt>채널</dt><dd>{IOT_CHANNELS.map((c) => `${c.name} ${snap.leds[c.id].channelOn ? '켬' : '끔'}`).join(' · ')}</dd></div>
        </dl>
      )}
      <div className="small" style={{ marginTop: 14, fontWeight: 600 }}>마지막으로 저장한 사건 파형</div>
      {!last ? (
        <p className="hint">아직 저장된 사건이 없습니다. 장치를 연결하고 점퍼선을 뽑거나 스위치로 꺼 보세요.</p>
      ) : (
        <>
          <div style={{ height: 130, marginTop: 6 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                <CartesianGrid stroke={CHART.grid} vertical={false} />
                <XAxis dataKey="t" tick={CHART.tick} axisLine={CHART.axisLine} tickLine={CHART.tickLine} unit="ms" minTickGap={40} />
                <YAxis tick={CHART.tick} axisLine={CHART.axisLine} tickLine={CHART.tickLine} unit="" width={48} domain={['auto', 'auto']} />
                <Tooltip formatter={(v) => [`${Number(v).toFixed(2)} mA`, '전류']} labelFormatter={(t) => `${t} ms`} />
                <ReferenceLine x={0} stroke={CHART.warn} strokeDasharray="3 3" />
                <Line type="stepAfter" dataKey="mA" stroke={CHART.accent} dot={false} strokeWidth={1.6} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="small" style={{ marginTop: 6 }}>
            {last.e.src === 'cmd' ? `명령으로 생긴 사건 (${last.e.cmd})` : '명령 없이 전류가 바뀐 사건'} · AI:{' '}
            {last.verdict.kind === 'ANSWERED' ? <b>{last.verdict.labelKo}</b> : last.verdict.kind === 'WITHHELD' ? <b>보류 (확실하지 않음)</b> : '판단 안 함'}
          </div>
        </>
      )}
    </>
  )
}

function Reference() {
  const [list, setList] = useState<RefList | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [id, setId] = useState<string | null>(null)
  const [detail, setDetail] = useState<RefDetail | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let alive = true
    fetch(`${apiBase()}/api/v1/reference-waveforms`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: RefList) => {
        if (!alive) return
        setList(d)
        setId(d.items[0]?.id ?? null)
      })
      .catch((e: Error) => alive && setErr(`분석 서버에서 목록을 받지 못했습니다 (${e.message}). 서버가 이 기능을 아직 배포하지 않았을 수 있습니다.`))
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!id) return
    let alive = true
    setLoading(true)
    fetch(`${apiBase()}/api/v1/reference-waveforms/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: RefDetail) => alive && setDetail(d))
      .catch((e: Error) => alive && setErr(`파형을 받지 못했습니다 (${e.message})`))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [id])

  if (err) return <p className="hint">{err}</p>
  if (!list) return <p className="hint">불러오는 중…</p>
  return (
    <>
      <p className="hint" style={{ marginTop: 0 }}>
        국내 FRTU 고장파형은 공개된 것이 없어, 해외 배전·변전 계통에서 <b>실제로 측정한 공개 고장파형</b>을 보여 줍니다. FRTU 기록은 아닙니다. 고른 파형은 모두 AI 학습에 쓰지 않은 것입니다.
      </p>
      <select className="input" value={id ?? ''} onChange={(e) => setId(e.target.value)} style={{ width: '100%' }} aria-label="참고 파형 선택">
        {list.items.map((it) => (
          <option key={it.id} value={it.id}>
            {it.country === 'CN' ? '중국' : '러시아'} · 정답 {it.label_ko} ({it.label})
          </option>
        ))}
      </select>
      {loading && <p className="hint">파형과 AI 판단을 계산하는 중…</p>}
      {detail && !loading && <RefView d={detail} />}
      <p className="hint small" style={{ marginTop: 8 }}>{list.selection_rule}</p>
    </>
  )
}

function RefView({ d }: { d: RefDetail }) {
  const step = Math.max(1, Math.floor(d.rows / 400)) // 화면용으로만 건너뜀 (AI 는 서버에서 전체 파형으로 판단)
  const cur = d.channels.map((c, k) => [c, k] as const).filter(([c]) => c.startsWith('I'))
  const vol = d.channels.map((c, k) => [c, k] as const).filter(([c]) => c.startsWith('V'))
  const rows = useMemo(() => {
    const out: Record<string, number>[] = []
    for (let r = 0; r < d.rows; r += step) {
      const row: Record<string, number> = { t: +((r / d.sampling_rate_hz) * 1000).toFixed(2) }
      d.channels.forEach((c, k) => (row[c] = d.waveform[r][k]))
      out.push(row)
    }
    return out
  }, [d, step])
  const ai = d.ai
  const verdict = !ai
    ? '서버에 AI 모델이 없습니다'
    : ai.status === 'ok' && ai.prediction
      ? `${LABEL_KO[ai.prediction.label] ?? ai.prediction.label} (${ai.prediction.label})`
      : '보류 (확실하지 않음)'
  const hit = ai?.status === 'ok' && ai.prediction?.label === d.label
  return (
    <div style={{ marginTop: 10 }}>
      {[
        ['전류', cur],
        ['전압', vol],
      ].map(([title, chs]) => (
        <div key={title as string} style={{ height: 110, marginTop: 4 }}>
          <div className="small muted">{title as string} ({(chs as readonly (readonly [string, number])[]).map(([c]) => c).join(', ')}, 원본 단위)</div>
          <ResponsiveContainer width="100%" height="88%">
            <LineChart data={rows} margin={{ top: 4, right: 6, left: -18, bottom: 0 }}>
              <CartesianGrid stroke={CHART.grid} vertical={false} />
              <XAxis dataKey="t" tick={CHART.tick} axisLine={CHART.axisLine} tickLine={CHART.tickLine} unit="ms" minTickGap={50} />
              <YAxis tick={CHART.tick} axisLine={CHART.axisLine} tickLine={CHART.tickLine} width={48} />
              {(chs as readonly (readonly [string, number])[]).map(([c], k) => (
                <Line key={c} dataKey={c} stroke={COLORS[k % COLORS.length]} dot={false} strokeWidth={1.2} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ))}
      <dl className="kv" style={{ marginTop: 10 }}>
        <div><dt>정답 (데이터셋 라벨)</dt><dd>{d.label_ko} ({d.label})</dd></div>
        <div><dt>AI 판단</dt><dd><b>{verdict}</b>{ai?.status === 'ok' && (hit ? ' · 정답과 같음' : ' · 정답과 다름')}</dd></div>
        {ai && ai.status !== 'ok' && ai.reasons && ai.reasons.length > 0 && (
          <div><dt>보류 이유</dt><dd>{ai.reasons.map((r) => r.message).join(' / ')}</dd></div>
        )}
        <div><dt>측정 조건</dt><dd>{d.sampling_rate_hz} Hz · 계통 {d.system_freq_hz} Hz · {d.channels.length}채널 · {d.rows}샘플</dd></div>
        <div>
          <dt>출처</dt>
          <dd>
            <a href={d.source.url} target="_blank" rel="noreferrer">{d.source.title}</a> ({d.source.license}) · 실측 · FRTU 기록 아님
          </dd>
        </div>
      </dl>
    </div>
  )
}
