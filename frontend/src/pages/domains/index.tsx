import { useState, useEffect } from 'react'
import {
  Card,
  Table,
  Button,
  Space,
  Input,
  Message,
  Popconfirm,
  Tag,
  Typography,
} from '@arco-design/web-react'
import {
  IconSync,
  IconDelete,
  IconSettings,
  IconSearch,
  IconRefresh,
} from '@arco-design/web-react/icon'
import { useNavigate } from 'react-router-dom'
import api from '@/api'
import { providerLogo, providerShort, providerColor } from '@/utils/provider'

const { Title } = Typography

interface Platform {
  id: number
  name: string
  type: string
  created_at: string
}

interface Domain {
  id: number
  platform_id: number
  domain: string
  status: string
  platform?: Platform
}

export default function Domains() {
  const [domains, setDomains] = useState<Domain[]>([])
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [keyword, setKeyword] = useState('')
  const [syncing, setSyncing] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    fetchDomains()
  }, [page, pageSize, keyword])

  const fetchDomains = async () => {
    setLoading(true)
    try {
      const res = await api.get('/domains', { params: { page, page_size: pageSize, keyword } })
      setDomains(res.data.data || [])
      setTotal(res.data.total || 0)
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '加载域名失败')
    } finally {
      setLoading(false)
    }
  }

  const handleBatchSync = async () => {
    setSyncing(true)
    try {
      const res = await api.post('/platforms/sync-all')
      const errs = res.data.errors || []
      if (errs.length > 0) {
        Message.warning(`同步完成：新增 ${res.data.added} 个域名，共 ${res.data.total} 个。${errs.length} 个平台失败：${errs.join('；')}`)
      } else {
        Message.success(`批量同步完成：新增 ${res.data.added} 个域名，共 ${res.data.total} 个（${res.data.platforms} 个平台）`)
      }
      fetchDomains()
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '批量同步失败')
    } finally {
      setSyncing(false)
    }
  }

  const handleSyncRecords = async (id: number) => {
    setLoading(true)
    try {
      const res = await api.post(`/domains/${id}/sync-records`)
      Message.success(`同步完成，共 ${res.data.count} 条记录`)
      fetchDomains()
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '同步失败')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/domains/${id}`)
      Message.success('已删除')
      fetchDomains()
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '删除失败')
    }
  }

  const columns = [
    {
      title: '域名',
      dataIndex: 'domain',
      render: (domain: string, record: Domain) => (
        <Space>
          <img
            src={providerLogo[record.platform?.type || '']}
            alt={record.platform?.type}
            width={20}
            height={20}
          />
          <span
            style={{ color: 'var(--color-text-1)', cursor: 'pointer' }}
            onClick={() => navigate(`/domains/${record.id}/records`)}
          >
            {domain}
          </span>
        </Space>
      ),
    },
    {
      title: '类型',
      dataIndex: 'platform',
      width: 120,
      className: 'col-hide-mobile',
      render: (p: Platform) => {
        const type = p?.type || ''
        return type ? (
          <Tag color={providerColor[type]}>{providerShort[type]}</Tag>
        ) : (
          '-'
        )
      },
    },
    {
      title: '服务商',
      dataIndex: 'platform',
      width: 140,
      className: 'col-hide-mobile',
      render: (p: Platform) => p?.name || '-',
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      className: 'col-hide-mobile',
      render: (s: string) => <Tag color={s === 'active' ? 'green' : 'gray'}>{s}</Tag>,
    },
    {
      title: '操作',
      width: 220,
      render: (_: any, record: Domain) => (
        <Space>
          <Button
            type="text"
            icon={<IconSettings />}
            onClick={() => navigate(`/domains/${record.id}/records`)}
            size="small"
          >
            <span className="mobile-btn-text">解析管理</span>
          </Button>
          <Button type="text" icon={<IconSync />} onClick={() => handleSyncRecords(record.id)} size="small">
            <span className="mobile-btn-text">同步</span>
          </Button>
          <Popconfirm title="确定删除此域名？" onOk={() => handleDelete(record.id)}>
            <Button type="text" status="danger" icon={<IconDelete />} size="small">
              <span className="mobile-btn-text">删除</span>
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <Title heading={4} style={{ marginBottom: 16 }}>域名列表</Title>
      <Card>
        <div className="filter-bar" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <Input
            prefix={<IconSearch />}
            placeholder="搜索域名"
            style={{ width: 260 }}
            value={keyword}
            onChange={(v) => {
              setKeyword(v)
              setPage(1)
            }}
            allowClear
          />
          <Space>
            <Button type="primary" icon={<IconRefresh />} onClick={handleBatchSync} loading={syncing}>
              <span className="mobile-btn-text">批量同步</span>
            </Button>
          </Space>
          <div style={{ flex: 1 }} />
          <span style={{ color: 'var(--color-text-3)', fontSize: 13 }}>
            点击域名名称或「解析管理」进入 DNS 解析管理
          </span>
        </div>
        <div className="table-responsive">
          <Table
            columns={columns}
            data={domains}
            rowKey="id"
            loading={loading}
            pagination={{
              current: page,
              pageSize,
              total,
              showTotal: true,
              onChange: (p, ps) => {
                setPage(p)
                setPageSize(ps)
              },
            }}
          />
        </div>
      </Card>
    </div>
  )
}
