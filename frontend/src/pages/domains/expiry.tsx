import { useState, useEffect } from 'react'
import {
  Card,
  Table,
  Button,
  Space,
  Message,
  Tag,
  Switch,
  Typography,
} from '@arco-design/web-react'
import { IconSync, IconRefresh } from '@arco-design/web-react/icon'
import api from '@/api'
import { providerLogo, providerLabel, providerColor } from '@/utils/provider'

const { Title } = Typography

interface Platform {
  id: number
  name: string
  type: string
}

interface Domain {
  id: number
  platform_id: number
  domain: string
  status: string
  expires_at: string | null
  expiry_checked_at: string | null
  auto_renew: boolean
  auto_renew_supported: boolean
  platform?: Platform
}

export default function DomainExpiry() {
  const [domains, setDomains] = useState<Domain[]>([])
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(false)
  const [toggling, setToggling] = useState<Record<number, boolean>>({})
  const [pagination, setPagination] = useState({
    current: 1,
    pageSize: 20,
    total: 0,
  })

  useEffect(() => {
    fetchDomains(pagination.current, pagination.pageSize)
  }, [])

  const fetchDomains = async (page: number, pageSize: number) => {
    setLoading(true)
    try {
      const res = await api.get('/domains', { params: { page, page_size: pageSize } })
      setDomains(res.data.data || [])
      setPagination((prev) => ({ ...prev, total: res.data.total || 0 }))
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '加载域名失败')
    } finally {
      setLoading(false)
    }
  }

  const handlePageChange = (page: number, pageSize: number) => {
    setPagination((prev) => ({ ...prev, current: page, pageSize }))
    fetchDomains(page, pageSize)
  }

  const handleCheckAll = async () => {
    setChecking(true)
    try {
      const res = await api.post('/domains/check-all-expiry')
      const errs = res.data.errors || []
      if (errs.length > 0) {
        Message.warning(`查询完成，${errs.length} 个域名失败：${errs.join('；')}`)
      } else {
        Message.success(`已查询 ${res.data.total} 个域名到期信息`)
      }
      fetchDomains(pagination.current, pagination.pageSize)
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '批量查询失败')
    } finally {
      setChecking(false)
    }
  }

  const handleCheckOne = async (id: number) => {
    try {
      await api.post(`/domains/${id}/check-expiry`)
      Message.success('查询成功')
      fetchDomains(pagination.current, pagination.pageSize)
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '查询失败')
    }
  }

  const handleToggleAutoRenew = async (id: number, checked: boolean) => {
    setToggling((prev) => ({ ...prev, [id]: true }))
    try {
      await api.put(`/domains/${id}/auto-renew`, { auto_renew: checked })
      Message.success(checked ? '已开启自动续费' : '已关闭自动续费')
      fetchDomains(pagination.current, pagination.pageSize)
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '设置失败')
    } finally {
      setToggling((prev) => ({ ...prev, [id]: false }))
    }
  }

  const getExpiryStatus = (domain: Domain) => {
    const { expires_at, expiry_checked_at } = domain
    if (!expires_at) {
      if (expiry_checked_at) return { label: '无法获取', color: 'gray' }
      return { label: '未查询', color: 'gray' }
    }
    const now = new Date()
    const expiry = new Date(expires_at)
    const days = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    if (days < 0) return { label: '已过期', color: 'red' }
    if (days <= 7) return { label: `${days} 天`, color: 'red' }
    if (days <= 30) return { label: `${days} 天`, color: 'orangered' }
    return { label: `${days} 天`, color: 'green' }
  }

  const formatDate = (d: string | null) => {
    if (!d) return '-'
    return new Date(d).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
  }

  const columns = [
    {
      title: '域名',
      dataIndex: 'domain',
      render: (domain: string, record: Domain) => (
        <Space>
          {record.platform && (
            <img
              src={providerLogo[record.platform.type]}
              alt={record.platform.type}
              width={18}
              height={18}
            />
          )}
          <span>{domain}</span>
        </Space>
      ),
    },
    {
      title: '平台',
      dataIndex: 'platform',
      width: 120,
      className: 'col-hide-mobile',
      render: (platform: Platform | undefined) =>
        platform ? (
          <Tag color={providerColor[platform.type]}>
            {providerLabel[platform.type] || platform.name}
          </Tag>
        ) : (
          '-'
        ),
    },
    {
      key: 'expires_at_date',
      title: '到期时间',
      dataIndex: 'expires_at',
      width: 130,
      render: (d: string | null) => formatDate(d),
    },
    {
      key: 'expires_at_days',
      title: '到期状态',
      dataIndex: 'expires_at',
      width: 100,
      render: (_d: string | null, record: Domain) => {
        const status = getExpiryStatus(record)
        return <Tag color={status.color}>{status.label}</Tag>
      },
    },
    {
      title: '自动续费',
      dataIndex: 'auto_renew',
      width: 120,
      render: (autoRenew: boolean, record: Domain) => {
        if (!record.auto_renew_supported) {
          return <Tag color="gray">暂不支持</Tag>
        }
        return (
          <Switch
            checked={autoRenew}
            loading={toggling[record.id]}
            onChange={(checked) => handleToggleAutoRenew(record.id, checked)}
          />
        )
      },
    },
    {
      title: '操作',
      width: 100,
      render: (_: any, record: Domain) => (
        <Button
          type="text"
          icon={<IconSync />}
          size="small"
          onClick={() => handleCheckOne(record.id)}
        >
          查询
        </Button>
      ),
    },
  ]

  return (
    <div>
      <Title heading={4} style={{ marginBottom: 16 }}>域名到期查询</Title>
      <Card>
        <div
          className="filter-bar"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: 16,
            flexWrap: 'wrap',
          }}
        >
          <Space>
            <Button
              type="primary"
              icon={<IconRefresh />}
              onClick={handleCheckAll}
              loading={checking}
            >
              查询所有到期时间
            </Button>
          </Space>
        </div>
        <div className="table-responsive">
          <Table
            columns={columns}
            data={domains}
            rowKey="id"
            loading={loading}
            pagination={{
              current: pagination.current,
              pageSize: pagination.pageSize,
              total: pagination.total,
              showTotal: true,
              showJumper: true,
              sizeCanChange: true,
              onChange: handlePageChange,
              onPageSizeChange: (pageSize: number) => handlePageChange(1, pageSize),
            }}
          />
        </div>
      </Card>
    </div>
  )
}