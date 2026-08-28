import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Tag } from '@arco-design/web-react'
import { providerShort, providerColor } from '@/utils/provider'

function countryEmoji(country: string): string {
  const map: Record<string, string> = {
    'United States': '🇺🇸', 'China': '🇨🇳', 'Japan': '🇯🇵', 'Germany': '🇩🇪',
    'United Kingdom': '🇬🇧', 'France': '🇫🇷', 'South Korea': '🇰🇷', 'Canada': '🇨🇦',
    'Australia': '🇦🇺', 'Singapore': '🇸🇬', 'Netherlands': '🇳🇱', 'Brazil': '🇧🇷',
    'India': '🇮🇳', 'Russia': '🇷🇺', 'Hong Kong': '🇭🇰', 'Taiwan': '🇹🇼',
  }
  return map[country] || ''
}

export const DomainNode = memo(({ data }: NodeProps) => {
  const platform = data.platform as string || ''
  const label = data.label as string || ''
  return (
    <div style={{
      padding: '10px 14px',
      borderRadius: 8,
      background: 'var(--color-bg-2)',
      border: '2px solid var(--color-primary-light-3)',
      boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
      minWidth: 160,
      fontSize: 13,
    }}>
      <Handle type="source" position={Position.Right} />
      <div style={{ fontWeight: 700, marginBottom: 4, wordBreak: 'break-all' }}>{label}</div>
      {platform && (
        <Tag color={providerColor[platform] || 'arcoblue'} size="small">
          {providerShort[platform] || platform}
        </Tag>
      )}
    </div>
  )
})

export const IPNode = memo(({ data }: NodeProps) => {
  const label = data.label as string || ''
  const country = data.country as string || ''
  const city = data.city as string || ''
  const isp = data.isp as string || ''
  return (
    <div style={{
      padding: '10px 14px',
      borderRadius: 8,
      background: 'var(--color-bg-2)',
      border: '2px solid var(--color-success-light-3)',
      boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
      minWidth: 160,
      fontSize: 13,
    }}>
      <Handle type="target" position={Position.Left} />
      <div style={{ fontWeight: 700, marginBottom: 4, fontFamily: 'monospace' }}>{label}</div>
      {country && (
        <div style={{ fontSize: 11, color: 'var(--color-text-3)', lineHeight: 1.6 }}>
          {countryEmoji(country)} {country}{city ? ` · ${city}` : ''}
          {isp ? <div>{isp}</div> : null}
        </div>
      )}
    </div>
  )
})

export const TargetNode = memo(({ data }: NodeProps) => {
  const label = data.label as string || ''
  return (
    <div style={{
      padding: '8px 12px',
      borderRadius: 6,
      background: 'var(--color-bg-2)',
      border: '2px solid var(--color-warning-light-3)',
      boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
      fontSize: 12,
      fontFamily: 'monospace',
    }}>
      <Handle type="target" position={Position.Left} />
      {label}
    </div>
  )
})

export const nodeTypes = {
  domainNode: DomainNode,
  ipNode: IPNode,
  targetNode: TargetNode,
}