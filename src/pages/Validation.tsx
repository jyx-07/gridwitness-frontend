import { useEffect, useState } from 'react'
import ModelCardPanel from '../components/ModelCardPanel'
import { Metric, Metrics, PageHeader, Section } from '../components/ui'
import { loadModelCard, type ModelCard } from '../lib/aiExplain'
import { EVENT_MODEL, FEATURE_KO, forestPredict } from '../lib/villageEvents'

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`

/** 학습 리포트에 들어 있는 마을 사건 모델 평가값 (village_events_model.json 그대로) */
interface VillageMetrics {
  n_train: number
  n_test: number
  split: string
  test_all: { accuracy: number; macro_f1: number; confusion?: { labels: string[]; rows_true_cols_pred: number[][] } }
  test_selective: { abstained: number; coverage: number; selective_accuracy: number | null }
  fault_vs_not: { nonfault_called_fault: number; fault_called_nonfault: number }
}
interface VillageExtras {
  metrics?: VillageMetrics
  importance?: { name: string; value: number }[]
}

/** 이 브라우저에서 마을 사건 모델 1건 판정에 걸리는 시간을 직접 잰다 (반복 측정 평균) */
function measureInferenceMs(runs = 300): number | null {
  if (!EVENT_MODEL.trees.length) return null
  const x = EVENT_MODEL.features.map(() => 0)
  forestPredict(EVENT_MODEL.trees, x)
  const t0 = performance.now()
  for (let k = 0; k < runs; k++) forestPredict(EVENT_MODEL.trees, x)
  return (performance.now() - t0) / runs
}

/** AI 성능 검증: 학습에 쓰지 않은 시험 데이터로 잰 결과를 한 화면에. 숫자는 학습 리포트 값을 그대로 쓰고 여기서 만들지 않는다 */
export default function Validation() {
  const [card, setCard] = useState<ModelCard | null>(null)
  const [latency, setLatency] = useState<number | null>(null)
  useEffect(() => {
    loadModelCard().then(setCard, () => setCard(null))
    setLatency(measureInferenceMs())
  }, [])

  const extras = EVENT_MODEL as unknown as VillageExtras
  const vm = extras.metrics
  const cnSel = card?.test_selective
  const cnAnswered = cnSel ? cnSel.n - cnSel.abstained : 0

  return (
    <>
      <PageHeader
        title="AI 성능 검증"
        description="학습에 쓰지 않은 시험 데이터로 잰 실제 결과예요. 숫자는 모델 학습 리포트의 값을 그대로 옮겼고, 판정 시간만 이 브라우저에서 지금 직접 잽니다."
      />

      <Section title="한눈에 보기">
        <Metrics cols={4}>
          <Metric
            label="고장파형 AI · 답한 것의 정확도"
            value={cnSel ? pct(cnSel.selective_accuracy) : '—'}
            foot={cnSel ? `시험 ${cnSel.n}건 중 답한 ${cnAnswered}건 기준 · 중국 공개 파형` : '평가 자료 불러오는 중'}
          />
          <Metric
            label="마을 사건 AI · 정확도"
            value={vm ? pct(vm.test_all.accuracy) : '—'}
            foot={vm ? `시험 ${vm.n_test}건 · 우노 모형 실측 사건` : '평가 자료 없음'}
          />
          <Metric
            label="모르면 보류"
            value={cnSel && vm ? `${cnSel.abstained + vm.test_selective.abstained}건` : '—'}
            foot={cnSel && vm ? `고장파형 ${cnSel.abstained}/${cnSel.n} · 마을 사건 ${vm.test_selective.abstained}/${vm.n_test}` : undefined}
          />
          <Metric
            label="판정 시간 (지금 측정)"
            value={latency == null ? '—' : latency < 0.01 ? '0.01ms 미만' : `${latency.toFixed(2)}ms`}
            foot="이 브라우저에서 마을 사건 모델 1건 판정, 300회 평균"
          />
        </Metrics>
      </Section>

      {vm && (
        <Section
          title="마을 사건 AI (우노 모형)"
          description={`우노가 녹화한 사건 파형을 ${EVENT_MODEL.labels.length}가지 유형으로 나눠요. 학습 ${vm.n_train}건, 시험 ${vm.n_test}건 (${vm.split}).`}
        >
          <div className="grid-2" style={{ gap: 20 }}>
            <div>
              <strong className="small">정답과 AI 판정 비교 (시험 {vm.n_test}건)</strong>
              {vm.test_all.confusion ? (
                <ConfusionTable labels={vm.test_all.confusion.labels} rows={vm.test_all.confusion.rows_true_cols_pred} names={EVENT_MODEL.label_ko} />
              ) : (
                <p className="small muted">리포트에 표가 없어요.</p>
              )}
              <p className="small muted" style={{ marginTop: 8 }}>
                고장을 정상으로 놓친 건 <b>{vm.fault_vs_not.fault_called_nonfault}건</b>, 정상을 고장으로 잘못 본 건 <b>{vm.fault_vs_not.nonfault_called_fault}건</b>입니다.
                macro-F1 {vm.test_all.macro_f1.toFixed(3)}.
              </p>
            </div>
            <div>
              <strong className="small">판단에 많이 쓰인 특징</strong>
              <ul className="val-imp">
                {(extras.importance ?? []).slice(0, 6).map((f, _i, all) => (
                  <li key={f.name}>
                    <span>{FEATURE_KO[f.name] ?? f.name}</span>
                    <i style={{ width: `${(f.value / all[0].value) * 100}%` }} />
                    <b className="num">{f.value.toFixed(3)}</b>
                  </li>
                ))}
              </ul>
              <p className="small muted" style={{ marginTop: 8 }}>
                판단 기준: 1순위 점수 ≥ {EVENT_MODEL.thresholds.score} · 1·2위 차 ≥ {EVENT_MODEL.thresholds.margin}. 하나라도 못 넘으면 답하지 않고 보류합니다.
              </p>
            </div>
          </div>
        </Section>
      )}

      <ModelCardPanel />

      <p className="xs muted" style={{ marginTop: 12 }}>
        러시아(RU) 고장파형 모델의 평가 수치는 서버 학습 리포트에 있고, 이 화면에는 아직 넣지 않았어요. 모든 수치는 공개 데이터와 모형 실측 기준이며, 한전 FRTU 실제 파형으로 잰 값이 아닙니다.
      </p>
    </>
  )
}

/** 행 = 실제 정답, 열 = AI 판정. 대각선이 맞힌 건수 */
function ConfusionTable({ labels, rows, names }: { labels: string[]; rows: number[][]; names: Record<string, string> }) {
  return (
    <div className="val-cm-wrap">
      <table className="val-cm">
        <thead>
          <tr>
            <th>정답 \ 판정</th>
            {labels.map((l) => <th key={l}>{names[l] ?? l}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={labels[i]}>
              <th>{names[labels[i]] ?? labels[i]}</th>
              {row.map((n, j) => (
                <td key={j} className={n === 0 ? 'zero' : i === j ? 'hit' : 'miss'}>{n}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
