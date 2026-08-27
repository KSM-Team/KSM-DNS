import { useState, useEffect } from 'react'
import {
  Card,
  Table,
  Button,
  Space,
  Message,
  Select,
  Input,
  Tag,
  Typography,
  Grid,
} from '@arco-design/web-react'
import { IconSwap, IconEye, IconCheck } from '@arco-design/web-react/icon'
import api from '@/api'
import { providerLogo, providerLabel, providerColor } from '@/utils/provider'

const { Title, Text } = Typography

interface Platform {
  id: number
  name: string
  type: string
  domain_count: number
}

interface DomainItem {
  id: number
  domain: string
  platform_id: number
}

interface DNSRecord {
  name: string
  type: string
  value: string
  ttl: number
}

interface MigrateResult {
  name: string
  type: string
  value: string
  ttl: number
  error?: string
}

export default function DNSMigrate() {
  const [platforms, setPlatforms] = useState<Platform[]>([])
  const [domains, setDomains] = useState<DomainItem[]>([])
  const [srcPlatformId, setSrcPlatformId] = useState<number | undefined>()
  const [srcDomainId, setSrcDomainId] = useState<number | undefined>()
  const [srcDomain, setSrcDomain] = useState('')
  const [tgtPlatformId, setTgtPlatformId] = useState<number | undefined>()
  const [tgtDomain, setTgtDomain] = useState('')
  const [previewRecords, setPreviewRecords] = useState<DNSRecord[]>([])
  const [previewLoading, setPreviewLoading] = useState(false)
  const [migrating, setMigrating] = useState(false)
  const [results, setResults] = useState<MigrateResult[]>([])

  useEffect(() => {
    api.get('/platforms', { params: { page: 1, page_size: 100 } }).then((res) => {
      setPlatforms(res.data.data || [])
    })
    api.get('/domains', { params: { page: 1, page_size: 500 } }).then((res) => {
      setDomains(res.data.data || [])
    })
  }, [])

  const srcDomains = domains.filter((d) => d.platform_id === srcPlatformId)
  const srcPlatform = platforms.find((p) => p.id === srcPlatformId)
  const tgtPlatform = platforms.find((p) => p.id === tgtPlatformId)

  const handlePreview = async () => {
    if (!srcPlatformId || !srcDomainId) {
      Message.warning('请先选择源平台和域名')
      return
    }
    setPreviewLoading(true)
    try {
      const res = await api.get(`/domains/${srcDomainId}/records`, {
        params: { page: 1, page_size: 500 },
      })
      const records: DNSRecord[] = (res.data.data || []).map((r: any) => ({
        name: r.name,
        type: r.type,
        value: r.value,
        ttl: r.ttl,
      }))
      setPreviewRecords(records)
      if (records.length === 0) {
        Message.info('该域名下没有解析记录')
      }
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '获取记录失败')
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleMigrate = async () => {
    if (!srcPlatformId || !srcDomainId || !tgtPlatformId || !tgtDomain) {
      Message.warning('请填写完整的源和目标信息')
      return
    }
    if (previewRecords.length === 0) {
      Message.warning('请先预览源域名记录')
      return
    }
    setMigrating(true)
    try {
      const res = await api.post('/migrate/dns', {
        source_platform_id: srcPlatformId,
        source_domain: srcDomain,
        target_platform_id: tgtPlatformId,
        target_domain: tgtDomain,
      })
      const data = res.data
      setResults(data.results || [])
      if (data.failed === 0) {
        Message.success(`迁移完成！共 ${data.total} 条记录全部成功`)
      } else {
        Message.warning(`迁移完成：${data.success} 成功，${data.failed} 失败`)
      }
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '迁移失败')
    } finally {
      setMigrating(false)
    }
  }

  const previewColumns = [
    { title: '名称', dataIndex: 'name', width: 150 },
    { title: '类型', dataIndex: 'type', width: 80, render: (t: string) => <Tag color="arcoblue">{t}</Tag> },
    { title: '值', dataIndex: 'value', ellipsis: true },
    { title: 'TTL', dataIndex: 'ttl', width: 80 },
  ]

  const resultColumns = [
    { title: '名称', dataIndex: 'name', width: 120 },
    { title: '类型', dataIndex: 'type', width: 70, render: (t: string) => <Tag color="arcoblue">{t}</Tag> },
    { title: '值', dataIndex: 'value', ellipsis: true },
    { title: 'TTL', dataIndex: 'ttl', width: 70 },
    {
      title: '状态',
      dataIndex: 'error',
      width: 100,
      render: (err: string | undefined) =>
        err ? <Tag color="red">失败</Tag> : <Tag color="green">成功</Tag>,
    },
    {
      title: '错误信息',
      dataIndex: 'error',
      ellipsis: true,
      render: (err: string | undefined) => err || '-',
    },
  ]

  return (
    <div>
      <Title heading={4} style={{ marginBottom: 16 }}>DNS 迁移</Title>

      <Grid.Row gutter={16} style={{ marginBottom: 16 }}>
        <Grid.Col xs={24} sm={12}>
          <Card title="源平台">
            <Space direction="vertical" style={{ width: '100%' }} size="medium">
              <div>
                <Text type="secondary" style={{ marginBottom: 4, display: 'block' }}>选择平台</Text>
                <Select
                  placeholder="选择源平台"
                  style={{ width: '100%' }}
                  value={srcPlatformId}
                  onChange={(v) => {
                    setSrcPlatformId(v)
                    setSrcDomainId(undefined)
                    setSrcDomain('')
                    setPreviewRecords([])
                  }}
                >
                  {platforms.map((p) => (
                    <Select.Option key={p.id} value={p.id}>
                      <Space>
                        <img src={providerLogo[p.type]} alt={p.type} width={16} height={16} />
                        {p.name}
                        <Tag color={providerColor[p.type]} size="small">{providerLabel[p.type]}</Tag>
                      </Space>
                    </Select.Option>
                  ))}
                </Select>
              </div>
              <div>
                <Text type="secondary" style={{ marginBottom: 4, display: 'block' }}>选择域名</Text>
                <Select
                  placeholder="选择源域名"
                  style={{ width: '100%' }}
                  value={srcDomainId}
                  onChange={(v) => {
                    setSrcDomainId(v)
                    const found = srcDomains.find((d) => d.id === v)
                    setSrcDomain(found?.domain || '')
                    setPreviewRecords([])
                  }}
                  disabled={!srcPlatformId}
                >
                  {srcDomains.map((d) => (
                    <Select.Option key={d.id} value={d.id}>{d.domain}</Select.Option>
                  ))}
                </Select>
              </div>
              <Button
                icon={<IconEye />}
                onClick={handlePreview}
                loading={previewLoading}
                disabled={!srcPlatformId || !srcDomainId}
              >
                预览记录
              </Button>
            </Space>
          </Card>
        </Grid.Col>

        <Grid.Col xs={24} sm={12}>
          <Card title="目标平台">
            <Space direction="vertical" style={{ width: '100%' }} size="medium">
              <div>
                <Text type="secondary" style={{ marginBottom: 4, display: 'block' }}>选择平台</Text>
                <Select
                  placeholder="选择目标平台"
                  style={{ width: '100%' }}
                  value={tgtPlatformId}
                  onChange={(v) => {
                    setTgtPlatformId(v)
                    setResults([])
                  }}
                >
                  {platforms.map((p) => (
                    <Select.Option key={p.id} value={p.id}>
                      <Space>
                        <img src={providerLogo[p.type]} alt={p.type} width={16} height={16} />
                        {p.name}
                        <Tag color={providerColor[p.type]} size="small">{providerLabel[p.type]}</Tag>
                      </Space>
                    </Select.Option>
                  ))}
                </Select>
              </div>
              <div>
                <Text type="secondary" style={{ marginBottom: 4, display: 'block' }}>目标域名</Text>
                <Input
                  placeholder="输入目标域名，如 example.com"
                  value={tgtDomain}
                  onChange={(v) => {
                    setTgtDomain(v)
                    setResults([])
                  }}
                  disabled={!tgtPlatformId}
                />
              </div>
              <Button
                type="primary"
                icon={<IconCheck />}
                onClick={handleMigrate}
                loading={migrating}
                disabled={!srcPlatformId || !srcDomainId || !tgtPlatformId || !tgtDomain || previewRecords.length === 0}
              >
                一键迁移
              </Button>
            </Space>
          </Card>
        </Grid.Col>
      </Grid.Row>

      {previewRecords.length > 0 && (
        <Card title={`源记录预览 (${previewRecords.length} 条)`} style={{ marginBottom: 16 }}>
          <div className="table-responsive">
            <Table columns={previewColumns} data={previewRecords} rowKey={(r: DNSRecord) => `${r.name}-${r.type}`} pagination={false} />
          </div>
        </Card>
      )}

      {results.length > 0 && (
        <Card title={`迁移结果 (${results.filter((r) => !r.error).length}/${results.length} 成功)`}>
          <div className="table-responsive">
            <Table columns={resultColumns} data={results} rowKey={(r: MigrateResult, i: number) => `${r.name}-${r.type}-${i}`} pagination={false} />
          </div>
        </Card>
      )}
    </div>
  )
}