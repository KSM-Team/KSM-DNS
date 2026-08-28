import { useState, useEffect } from 'react'
import { Card, Tag, Typography, Grid, Space, Message, Button } from '@arco-design/web-react'
import { IconRefresh } from '@arco-design/web-react/icon'
import { SankeyChart } from '@visactor/react-vchart'
import { initVChartArcoTheme } from '@visactor/vchart-arco-theme'
import api from '@/api'
import { providerLogo, providerShort, providerColor } from '@/utils/provider'

const { Title } = Typography
const { Row, Col } = Grid

// 让 VChart 使用 Arco Design 的主题（自动跟随明暗模式）。
initVChartArcoTheme({ defaultMode: 'light' })

interface Platform {
  id: number
  name: string
  type: string
}

interface Domain {
  id: number
  domain: string
  platform_id: number
  platform?: Platform
}

interface Certificate {
  id: number
  domain_id: number
  domain_name: string
  provider: string
  expires_at: string
  status: string
}

interface SankeyLink {
  source: string
  target: string
  value: number
}

export default function Topology() {
  const [domains, setDomains] = useState<Domain[]>([])
  const [certs, setCerts] = useState<Certificate[]>([])
  const [loading, setLoading] = useState(false)

  const fetchData = async () => {
    setLoading(true)
    try {
      const [domainRes, certRes] = await Promise.all([
        api.get('/domains'),
        api.get('/ssl/certificates'),
      ])
      setDomains(domainRes.data.data || [])
      setCerts(certRes.data.data || [])
    } catch {
      Message.error('加载拓扑数据失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const buildLinks = (): SankeyLink[] => {
    const links: SankeyLink[] = []
    const platformName = (p?: Platform) => p?.name || '未分配平台'

    // 域名 → 服务商
    for (const d of domains) {
      links.push({ source: d.domain, target: platformName(d.platform), value: 1 })
    }
    // 服务商 → SSL 证书
    for (const c of certs) {
      const d = domains.find((x) => x.id === c.domain_id)
      links.push({ source: platformName(d?.platform), target: `${c.domain_name} 证书`, value: 1 })
    }
    return links
  }

  const links = buildLinks()

  const certRows = certs.map((c) => {
    const d = domains.find((x) => x.id === c.domain_id)
    return { cert: c, domain: d }
  })

  const formatTime = (t?: string) => (t ? t.slice(0, 10) : '-')

  const daysLeft = (t?: string) => {
    if (!t) return null
    const diff = new Date(t).getTime() - Date.now()
    return Math.ceil(diff / 86400000)
  }

  const renderSankey = () => {
    if (!links.length) {
      return (
        <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--color-text-3)' }}>
          暂无数据，请先在「DNS平台管理」和「SSL证书」中添加域名与证书。
        </div>
      )
    }
    return (
      <SankeyChart
        spec={{
          type: 'sankey',
          data: [
            { id: 'links', values: links },
            { id: 'nodes', values: [] },
          ],
          categoryField: 'source',
          valueField: 'value',
          sourceField: 'source',
          targetField: 'target',
          nodeAlign: 'justify',
          nodeGap: 12,
          nodeWidth: 16,
          minNodeHeight: 20,
          label: {
            visible: true,
            style: { fontSize: 12 },
          },
        }}
        style={{ width: '100%', height: '100%' }}
      />
    )
  }

  return (
    <div>
      <Title heading={4} style={{ marginBottom: 16 }}>DNS 拓扑图</Title>
      <Card>
        <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--color-text-3)' }}>
            展示「域名 → 服务商 → SSL 证书」的对应关系，证书节点含到期时间。
          </span>
          <Button icon={<IconRefresh />} onClick={fetchData} loading={loading}>
            <span className="mobile-btn-text">刷新</span>
          </Button>
        </div>

        <div style={{ height: 480, border: '1px solid var(--color-border-2)', borderRadius: 4 }}>
          {renderSankey()}
        </div>
      </Card>

      <Title heading={5} style={{ margin: '24px 0 16px' }}>证书到期情况</Title>
      <Row gutter={16}>
        {certRows.map(({ cert, domain }) => {
          const left = daysLeft(cert.expires_at)
          const tagColor = left === null
            ? 'gray'
            : left < 0 ? 'red' : left <= 30 ? 'orange' : 'green'
          return (
            <Col span={8} key={cert.id} style={{ marginBottom: 16 }}>
              <Card>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <img src={providerLogo[cert.provider] || providerLogo['letsencrypt']} alt={cert.provider} width={20} height={20} />
                  <span style={{ fontWeight: 600 }}>{cert.domain_name}</span>
                </div>
                <Space direction="vertical" size={4}>
                  <div>
                    <span style={{ color: 'var(--color-text-3)' }}>服务商：</span>
                    {domain?.platform ? (
                      <Space size={4}>
                        <img
                          src={providerLogo[domain.platform.type]}
                          alt={domain.platform.type}
                          width={16}
                          height={16}
                        />
                        <Tag color={providerColor[domain.platform.type]}>
                          {providerShort[domain.platform.type]} · {domain.platform.name}
                        </Tag>
                      </Space>
                    ) : (
                      '-'
                    )}
                  </div>
                  <div>
                    <span style={{ color: 'var(--color-text-3)' }}>到期时间：</span>
                    {formatTime(cert.expires_at)}
                  </div>
                  <div>
                    <span style={{ color: 'var(--color-text-3)' }}>剩余天数：</span>
                    <Tag color={tagColor}>
                      {left === null ? '未知' : left < 0 ? `已过期 ${Math.abs(left)} 天` : `${left} 天`}
                    </Tag>
                  </div>
                </Space>
              </Card>
            </Col>
          )
        })}
        {!certRows.length && (
          <Col span={24}>
            <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--color-text-3)' }}>
              暂无 SSL 证书。
            </div>
          </Col>
        )}
      </Row>
    </div>
  )
}
