import type { FiCheck } from '../lib/fiCheck'
import { Src } from './AiExplain'

const ICON = { CONFIRMED: '✓', SUSPECT: '!', UNKNOWN: '?' } as const

/** FI 교차검증 결과: 배전자동화 고장표시(FI)를 파형으로 다시 확인 */
export default function FiCheckBox({ check, compact }: { check: FiCheck; compact?: boolean }) {
  return (
    <div className={`ficheck ${check.kind.toLowerCase()}`}>
      <span className="ficheck-icon" aria-hidden>{ICON[check.kind]}</span>
      <div>
        <div className="ficheck-top">
          <span className="ficheck-k">FI 교차검증</span>
          <b>{check.title}</b>
          {!compact && <Src kind="calc" />}
        </div>
        <p>{check.reason}</p>
        {!compact && <p className="xs muted">배전자동화의 고장표시(FI)는 규칙으로 정해져 돌입전류·개폐 과도에도 뜰 수 있어요. 판정을 바꾸지 않고 현장 확인 전 참고 근거로만 보여 줘요.</p>}
      </div>
    </div>
  )
}
