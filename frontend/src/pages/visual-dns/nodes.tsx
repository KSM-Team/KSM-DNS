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
  return map[country] || '🌐'
}

// ── Domain Node ────────────────────────────────────────────────────

export const DomainNode = memo(({ data }: NodeProps) => {
  const platform = data.platform as string || ''
  const label = data.label as string || ''
  return (
    <div style={{
      padding: '12px 16px',
      borderRadius: 10,
      background: 'linear-gradient(135deg, var(--color-bg-2) 0%, var(--color-primary-light-1) 100%)',
      border: '2px solid var(--color-primary-light-3)',
      boxShadow: '0 4px 16px rgba(var(--primary-6), 0.12), 0 1px 4px rgba(0,0,0,0.06)',
      minWidth: 180,
      fontSize: 13,
      transition: 'box-shadow 0.2s, transform 0.2s',
    }}>
      <Handle
        type="source"
        position={Position.Right}
        style={{
          width: 12,
          height: 12,
          background: 'var(--color-primary-light-2)',
          border: '3px solid var(--color-bg-2)',
          boxShadow: '0 0 0 1px var(--color-primary-light-3)',
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 16 }}>🌐</span>
        <span style={{ fontWeight: 700, wordBreak: 'break-all', lineHeight: 1.3 }}>
          {label}
        </span>
      </div>
      {platform && (
        <Tag color={providerColor[platform] || 'arcoblue'} size="small">
          {providerShort[platform] || platform}
        </Tag>
      )}
      <div style={{
        fontSize: 10,
        color: 'var(--color-text-4)',
        marginTop: 4,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
      }}>
        <span style={{
          display: 'inline-block',
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: 'var(--color-success)',
        }} />
        DNS 域名
      </div>
    </div>
  )
})

// ── IP Node ─────────────────────────────────────────────────────────

export const IPNode = memo(({ data }: NodeProps) => {
  const label = data.label as string || ''
  const country = data.country as string || ''
  const city = data.city as string || ''
  const isp = data.isp as string || ''
  return (
    <div style={{
      padding: '12px 16px',
      borderRadius: 10,
      background: 'linear-gradient(135deg, var(--color-bg-2) 0%, var(--color-success-light-1) 100%)',
      border: '2px solid var(--color-success-light-3)',
      boxShadow: '0 4px 16px rgba(var(--green-6), 0.12), 0 1px 4px rgba(0,0,0,0.06)',
      minWidth: 180,
      fontSize: 13,
      transition: 'box-shadow 0.2s, transform 0.2s',
    }}>
      <Handle
        type="target"
        position={Position.Left}
        style={{
          width: 12,
          height: 12,
          background: 'var(--color-success-light-2)',
          border: '3px solid var(--color-bg-2)',
          boxShadow: '0 0 0 1px var(--color-success-light-3)',
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 16 }}>🖥️</span>
        <span style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: 14 }}>
          {label}
        </span>
      </div>
      {country && (
        <div style={{ fontSize: 11, color: 'var(--color-text-3)', lineHeight: 1.6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>{countryEmoji(country)}</span>
            <span>{country}{city ? ` · ${city}` : ''}</span>
          </div>
          {isp && (
            <div style={{ fontSize: 10, color: 'var(--color-text-4)', marginTop: 2 }}>
              📡 {isp}
            </div>
          )}
        </div>
      )}
      {!country && (
        <div style={{ fontSize: 10, color: 'var(--color-text-4)' }}>
          ⚠️ 无地理信息
        </div>
      )}
    </div>
  )
})

// ── Target Node ─────────────────────────────────────────────────────

export const TargetNode = memo(({ data }: NodeProps) => {
  const label = data.label as string || ''
  return (
    <div style={{
      padding: '10px 14px',
      borderRadius: 8,
      background: 'linear-gradient(135deg, var(--color-bg-2) 0%, var(--color-warning-light-1) 100%)',
      border: '2px solid var(--color-warning-light-3)',
      boxShadow: '0 3px 12px rgba(var(--orange-6), 0.10), 0 1px 3px rgba(0,0,0,0.05)',
      fontSize: 12,
      fontFamily: 'monospace',
      minWidth: 120,
      transition: 'box-shadow 0.2s, transform 0.2s',
    }}>
      <Handle
        type="target"
        position={Position.Left}
        style={{
          width: 12,
          height: 12,
          background: 'var(--color-warning-light-2)',
          border: '3px solid var(--color-bg-2)',
          boxShadow: '0 0 0 1px var(--color-warning-light-3)',
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 14 }}>📋</span>
        <span>{label}</span>
      </div>
    </div>
  )
})

// ── Group Node ──────────────────────────────────────────────────────

export const GroupNode = memo(({ data }: NodeProps) => {
  const label = (data.label as string) || '未命名分组'
  const collapsed = (data.collapsed as boolean) || false
  const childCount = (data.childCount as number) || 0
  const color = (data.color as string) || '#6366f1'

  return (
    <div style={{
      width: '100%',
      height: '100%',
      borderRadius: 12,
      background: `${color}10`,
      border: `2px dashed ${color}60`,
      boxShadow: collapsed
        ? `0 2px 8px ${color}20`
        : `0 4px 20px ${color}15, 0 1px 4px rgba(0,0,0,0.04)`,
      transition: 'box-shadow 0.2s',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Header bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        background: `${color}18`,
        borderBottom: `1px solid ${color}30`,
        cursor: 'grab',
        userSelect: 'none',
      }}>
        <span style={{ fontSize: 14 }}>
          {collapsed ? '📁' : '📂'}
        </span>
        <span style={{
          fontWeight: 700,
          fontSize: 13,
          color: 'var(--color-text-1)',
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {label}
        </span>
        <span style={{
          fontSize: 11,
          color: 'var(--color-text-4)',
          background: `${color}20`,
          padding: '1px 6px',
          borderRadius: 10,
          fontWeight: 600,
        }}>
          {childCount}
        </span>
      </div>

      {/* Body — only visible when expanded */}
      {!collapsed && (
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--color-text-4)',
          fontSize: 12,
          pointerEvents: 'none',
        }}>
          {childCount === 0 && (
            <span>拖拽节点到此处，或用右键菜单添加</span>
          )}
        </div>
      )}
    </div>
  )
})

// ── Export node types ───────────────────────────────────────────────

export const nodeTypes = {
  domainNode: DomainNode,
  ipNode: IPNode,
  targetNode: TargetNode,
  groupNode: GroupNode,
}