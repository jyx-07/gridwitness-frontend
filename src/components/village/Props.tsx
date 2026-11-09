import { memo } from 'react'
import { AdditiveBlending } from 'three'
import type { LedState, NodeStatus } from '../../lib/village'
import Label from '../three/Label'
import SpeechBubble from '../three/SpeechBubble'
import { POLE_H, type V3 } from './layout'
import { glowTexture } from './textures'

export const STATUS_COLOR: Record<NodeStatus, string> = {
  NORMAL: '#ffd43b',
  OFF: '#495057',
  NO_DATA: '#868e96',
  WARNING: '#ff922b',
  FAULT: '#ff3b3b',
  OUTAGE: '#495057',
}

// ── 전봇대 ──────────────────────────────────────────────
export const Pole = memo(function Pole({ p, transformer = false }: { p: V3; transformer?: boolean }) {
  return (
    <group position={p}>
      <mesh position={[0, POLE_H / 2, 0]} castShadow>
        <cylinderGeometry args={[0.075, 0.12, POLE_H, 10]} />
        <meshStandardMaterial color="#9a9c9e" roughness={0.8} />
      </mesh>
      <mesh position={[0, POLE_H - 0.25, 0]} castShadow>
        <boxGeometry args={[1.3, 0.09, 0.09]} />
        <meshStandardMaterial color="#5c5f62" metalness={0.5} roughness={0.5} />
      </mesh>
      {[-0.5, 0, 0.5].map((x) => (
        <group key={x} position={[x, POLE_H - 0.12, 0]}>
          {[0, 0.06, 0.12].map((y) => (
            <mesh key={y} position={[0, y - 0.04, 0]}>
              <cylinderGeometry args={[0.055, 0.055, 0.035, 10]} />
              <meshStandardMaterial color="#e8eef2" roughness={0.3} />
            </mesh>
          ))}
        </group>
      ))}
      {transformer && (
        <group position={[0, POLE_H - 1.3, 0.22]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.2, 0.2, 0.55, 14]} />
            <meshStandardMaterial color="#8d9399" metalness={0.6} roughness={0.4} />
          </mesh>
          <mesh position={[0, 0.3, 0]}>
            <cylinderGeometry args={[0.21, 0.21, 0.05, 14]} />
            <meshStandardMaterial color="#6c737a" metalness={0.6} />
          </mesh>
        </group>
      )}
    </group>
  )
})

// ── 가로등 (실제 회로 채널 CH4·CH5) ─────────────────────
const LAMP_LABEL_BG: Record<NodeStatus, string> = {
  NORMAL: 'rgba(20,22,27,0.86)',
  OFF: 'rgba(110,116,128,0.86)',
  NO_DATA: 'rgba(150,155,165,0.86)',
  WARNING: 'rgba(184,100,0,0.92)',
  FAULT: 'rgba(207,52,52,0.94)',
  OUTAGE: 'rgba(40,43,50,0.92)',
}

export function StreetLamp({ c, view, pos, rot, night, selected, onSelect, showLabel = true, speech = null }: { c: LedState; view: { status: NodeStatus; text: string }; pos: V3; rot: number; night: boolean; selected: boolean; onSelect: () => void; showLabel?: boolean; speech?: string | null }) {
  const lit = c.lit
  const color = view.status === 'FAULT' ? '#ff6b6b' : view.status === 'WARNING' ? '#ffa94d' : '#ffe8a3'
  return (
    <group
      position={pos}
      onClick={(e) => {
        e.stopPropagation()
        onSelect()
      }}
      onPointerOver={() => (document.body.style.cursor = 'pointer')}
      onPointerOut={() => (document.body.style.cursor = '')}
    >
      <group rotation={[0, rot, 0]}>
        <mesh position={[0, 0.08, 0]}>
          <cylinderGeometry args={[0.13, 0.15, 0.16, 12]} />
          <meshStandardMaterial color="#343a40" metalness={0.6} roughness={0.4} />
        </mesh>
        <mesh position={[0, 1.4, 0]} castShadow>
          <cylinderGeometry args={[0.05, 0.065, 2.8, 10]} />
          <meshStandardMaterial color="#343a40" metalness={0.6} roughness={0.4} />
        </mesh>
        <mesh position={[0, 2.78, 0.3]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.03, 0.03, 0.6, 6]} />
          <meshStandardMaterial color="#343a40" metalness={0.6} roughness={0.4} />
        </mesh>
        <mesh position={[0, 2.72, 0.6]} castShadow>
          <boxGeometry args={[0.3, 0.1, 0.44]} />
          <meshStandardMaterial color="#212529" metalness={0.5} roughness={0.4} />
        </mesh>
        <mesh position={[0, 2.665, 0.6]} rotation={[Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.26, 0.38]} />
          <meshStandardMaterial color={lit ? '#fff8e1' : '#495057'} emissive={color} emissiveIntensity={lit ? (night ? 6 : 2.5) : 0} toneMapped={false} side={2} />
        </mesh>
        {/* 실제 조명 대신 바닥 빛 번짐 데칼 */}
        {night && lit && (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.14, 0.6]} renderOrder={1}>
            <planeGeometry args={[4.2, 4.2]} />
            <meshBasicMaterial map={glowTexture()} color={color} transparent opacity={0.55} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
          </mesh>
        )}
      </group>
      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.15, 0]}>
          <ringGeometry args={[0.55, 0.7, 40]} />
          <meshBasicMaterial color="#4dabf7" />
        </mesh>
      )}
      {showLabel && <Label
        lines={[c.name, `${c.fault ? '⚠ ' : ''}LED ${c.ch} · ${view.text}`]}
        position={[0, 3.55, 0]}
        bg={LAMP_LABEL_BG[view.status]}
        border="rgba(255,255,255,0.14)"
        pointer
        lineHeight={0.42}
      />}
      {showLabel && speech && <SpeechBubble text={speech} y={4.7} tone={view.status === 'FAULT' || view.status === 'OUTAGE' ? 'err' : 'warn'} />}
    </group>
  )
}
