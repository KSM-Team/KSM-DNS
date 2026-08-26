import { Card, Grid, Statistic, Message } from '@arco-design/web-react'
import {
  IconCloud,
  IconThunderbolt,
  IconSafe,
  IconClockCircle,
} from '@arco-design/web-react/icon'
import { useEffect, useState } from 'react'
import { PieChart, BarChart } from '@visactor/react-vchart'
import { initVChartArcoTheme } from '@visactor/vchart-arco-theme'
import api from '@/api'
import { providerLabel } from '@/utils/provider'

const { Row, Col } = Grid

// 让 VChart 使用 Arco Design 的主题（自动跟随明暗模式）。
initVChartArcoTheme({ defaultMode: 'light' })

interface Stats {
  domains: number
  failover_rules: number
  scheduler_tasks: number
  ssl_certificates: number
}

interface Platform {
  id: number
  name: string
  type: string
  domain_count: number
}

interface Cert {
  id: number
  domain_name: string
  status: string
  expires_at: string
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats>({ domains: 0, failover_rules: 0, scheduler_tasks: 0, ssl_certificates: 0 })
  const [platforms, setPlatforms] = useState<Platform[]>([])
  const [certs, setCerts] = useState<Cert[]>([])

  useEffect(() => {
    api.get('/dashboard/stats').then((res) => {
      setStats(res.data.data)
    }).catch((e: any) => {
      Message.error(e?.response?.data?.error || '加载统计失败')
    })
    api.get('/platforms', { params: { page: 1, page_size: 200 } }).then((res) => {
      setPlatforms(res.data.data || [])
    }).catch((e: any) => {
      Message.error(e?.response?.data?.error || '加载平台失败')
    })
    api.get('/ssl/certificates', { params: { page: 1, page_size: 200 } }).then((res) => {
      setCerts(res.data.data || [])
    }).catch((e: any) => {
      Message.error(e?.response?.data?.error || '加载证书失败')
    })
  }, [])

  // 平台域名分布（饼图）
  const platformPie = platforms
    .filter((p) => p.domain_count > 0)
    .map((p) => ({
      type: providerLabel[p.type] || p.name,
      value: p.domain_count,
    }))

  // 证书状态分布（柱状图）
  const statusCount: Record<string, number> = {}
  for (const c of certs) {
    statusCount[c.status] = (statusCount[c.status] || 0) + 1
  }
  const statusBar = [
    { type: '待签发', value: statusCount['pending'] || 0 },
    { type: '已签发', value: statusCount['issued'] || 0 },
    { type: '已过期', value: statusCount['expired'] || 0 },
    { type: '失败', value: statusCount['failed'] || 0 },
  ]

  const noData = () => (
    <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--color-text-3)' }}>
      暂无数据
    </div>
  )

  return (
    <div>
      <h3 style={{ marginBottom: 16 }}>仪表盘</h3>
      <Row gutter={16} className="dashboard-stats">
        <Col span={6}>
          <Card>
            <Statistic
              title="域名数量"
              value={stats.domains}
              prefix={<IconCloud style={{ color: '#3370ff' }} />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="容灾规则"
              value={stats.failover_rules}
              prefix={<IconThunderbolt style={{ color: '#ff7d00' }} />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="定时任务"
              value={stats.scheduler_tasks}
              prefix={<IconClockCircle style={{ color: '#00b42a' }} />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="SSL证书"
              value={stats.ssl_certificates}
              prefix={<IconSafe style={{ color: '#722ed1' }} />}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={16} className="dashboard-charts" style={{ marginTop: 16 }}>
        <Col span={12}>
          <Card title="平台域名分布">
            {platformPie.length ? (
              <PieChart
                spec={{
                  type: 'pie',
                  data: [{ id: 'data', values: platformPie }],
                  valueField: 'value',
                  categoryField: 'type',
                  outerRadius: 0.8,
                  innerRadius: 0.5,
                  label: { visible: true },
                  legends: { visible: true, orient: 'right' },
                }}
                style={{ width: '100%', height: 320 }}
              />
            ) : (
              noData()
            )}
          </Card>
        </Col>
        <Col span={12}>
          <Card title="SSL 证书状态">
            {certs.length ? (
              <BarChart
                spec={{
                  type: 'bar',
                  data: [{ id: 'data', values: statusBar }],
                  xField: 'type',
                  yField: 'value',
                  bar: { style: { fill: '#3370ff' } },
                  axes: [
                    { orient: 'bottom', type: 'band' },
                    { orient: 'left', type: 'linear' },
                  ],
                }}
                style={{ width: '100%', height: 320 }}
              />
            ) : (
              noData()
            )}
          </Card>
        </Col>
      </Row>
    </div>
  )
}
