import { useState, useEffect, useCallback } from 'react'
import {
  Card,
  Table,
  Button,
  Space,
  Input,
  Select,
  Message,
  Popconfirm,
  Tag,
  Switch,
  Typography,
  Modal,
  Checkbox,
} from '@arco-design/web-react'
import {
  IconSync,
  IconDelete,
  IconSettings,
  IconSearch,
  IconRefresh,
  IconTags,
} from '@arco-design/web-react/icon'
import { useNavigate } from 'react-router-dom'
import api from '@/api'
import { providerLogo, providerShort, providerColor } from '@/utils/provider'
import TagManager from '@/components/TagManager'

const { Title } = Typography

interface Platform {
  id: number
  name: string
  type: string
}

interface TagItem {
  id: number
  name: string
  color: string
}

interface DomainTag {
  id: number
  domain_id: number
  tag_id: number
  tag: TagItem
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
  tags?: DomainTag[]
  platform?: Platform
}

export default function Domains() {
  const [domains, setDomains] = useState<Domain[]>([])
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [keyword, setKeyword] = useState('')
  const [tagFilter, setTagFilter] = useState<number | undefined>()
  const [syncing, setSyncing] = useState(false)
  const [checking, setChecking] = useState(false)
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([])
  const [tagManagerVisible, setTagManagerVisible] = useState(false)
  const [allTags, setAllTags] = useState<TagItem[]>([])
  const [toggling, setToggling] = useState<Record<number, boolean>>({})
  const [tagAssignVisible, setTagAssignVisible] = useState(false)
  const [tagAssignDomainId, setTagAssignDomainId] = useState<number | null>(null)
  const [tagAssignSelected, setTagAssignSelected] = useState<number[]>([])
  const navigate = useNavigate()

  const fetchDomains = useCallback(async () => {
    setLoading(true)
    try {
      const params: any = { page, page_size: pageSize, keyword }
      if (tagFilter) params.tag_id = tagFilter
      const res = await api.get('/domains', { params })
      setDomains(res.data.data || [])
      setTotal(res.data.total || 0)
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '加载域名失败')
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, keyword, tagFilter])

  useEffect(() => {
    fetchDomains()
  }, [fetchDomains])

  // Load all tags for filter dropdown
  useEffect(() => {
    api.get('/tags').then((res) => setAllTags(res.data.data || [])).catch(() => {})
  }, [])

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

  const handleBatchDelete = async () => {
    if (selectedRowKeys.length === 0) {
      Message.warning('请先选择域名')
      return
    }
    let failed = 0
    for (const id of selectedRowKeys) {
      try {
        await api.delete(`/domains/${id}`)
      } catch {
        failed++
      }
    }
    setSelectedRowKeys([])
    if (failed > 0) {
      Message.warning(`已删除 ${selectedRowKeys.length - failed} 个，${failed} 个失败`)
    } else {
      Message.success(`已批量删除 ${selectedRowKeys.length} 个域名`)
    }
    fetchDomains()
  }

  const handleCheckAllExpiry = async () => {
    setChecking(true)
    try {
      const res = await api.post('/domains/check-all-expiry')
      const errs = res.data.errors || []
      if (errs.length > 0) {
        Message.warning(`查询完成，${errs.length} 个域名失败：${errs.join('；')}`)
      } else {
        Message.success(`已查询 ${res.data.total} 个域名到期信息`)
      }
      fetchDomains()
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '批量查询失败')
    } finally {
      setChecking(false)
    }
  }

  const handleCheckOneExpiry = async (id: number) => {
    try {
      await api.post(`/domains/${id}/check-expiry`)
      Message.success('查询成功')
      fetchDomains()
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '查询失败')
    }
  }

  const handleToggleAutoRenew = async (id: number, checked: boolean) => {
    setToggling((prev) => ({ ...prev, [id]: true }))
    try {
      await api.put(`/domains/${id}/auto-renew`, { auto_renew: checked })
      Message.success(checked ? '已开启自动续费' : '已关闭自动续费')
      fetchDomains()
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '设置失败')
    } finally {
      setToggling((prev) => ({ ...prev, [id]: false }))
    }
  }

  // Open tag assignment modal for a domain
  const openTagAssign = (domain: Domain) => {
    setTagAssignDomainId(domain.id)
    const currentTagIds = (domain.tags || []).map((dt) => dt.tag_id)
    setTagAssignSelected(currentTagIds)
    setTagAssignVisible(true)
  }

  // Save tag assignment
  const handleTagAssign = async () => {
    if (tagAssignDomainId === null) return
    try {
      await api.post(`/domains/${tagAssignDomainId}/tags`, { tag_ids: tagAssignSelected })
      Message.success('标签已更新')
      setTagAssignVisible(false)
      fetchDomains()
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '标签分配失败')
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
      key: 'tags',
      title: '标签',
      dataIndex: 'tags',
      width: 200,
      className: 'col-hide-mobile',
      render: (tags: DomainTag[] | undefined) => {
        if (!tags || tags.length === 0) return <span style={{ color: 'var(--color-text-4)' }}>-</span>
        return (
          <Space wrap size={4}>
            {tags.map((dt) => (
              <Tag key={dt.id} color={dt.tag?.color || 'arcoblue'} size="small">
                {dt.tag?.name || '-'}
              </Tag>
            ))}
          </Space>
        )
      },
    },
    {
      key: 'platform_type',
      title: '类型',
      dataIndex: 'platform',
      width: 100,
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
      key: 'platform_name',
      title: '服务商',
      dataIndex: 'platform',
      width: 120,
      className: 'col-hide-mobile',
      render: (p: Platform) => p?.name || '-',
    },
    {
      key: 'expires_at_date',
      title: '到期时间',
      dataIndex: 'expires_at',
      width: 120,
      className: 'col-hide-mobile',
      render: (d: string | null) => formatDate(d),
    },
    {
      key: 'expires_at_days',
      title: '到期状态',
      dataIndex: 'expires_at',
      width: 100,
      className: 'col-hide-mobile',
      render: (_d: string | null, record: Domain) => {
        const status = getExpiryStatus(record)
        return <Tag color={status.color}>{status.label}</Tag>
      },
    },
    {
      title: '自动续费',
      dataIndex: 'auto_renew',
      width: 110,
      className: 'col-hide-mobile',
      render: (autoRenew: boolean, record: Domain) => {
        if (!record.auto_renew_supported) {
          return <Tag color="gray">不支持</Tag>
        }
        return (
          <Switch
            checked={autoRenew}
            loading={toggling[record.id]}
            size="small"
            onChange={(checked) => handleToggleAutoRenew(record.id, checked)}
          />
        )
      },
    },
    {
      title: '操作',
      width: 300,
      render: (_: any, record: Domain) => (
        <Space>
          <Button
            type="text"
            icon={<IconSettings />}
            onClick={() => navigate(`/domains/${record.id}/records`)}
            size="small"
          >
            <span className="mobile-btn-text">解析</span>
          </Button>
          <Button type="text" icon={<IconSync />} onClick={() => handleSyncRecords(record.id)} size="small">
            <span className="mobile-btn-text">同步</span>
          </Button>
          <Button type="text" icon={<IconSync />} onClick={() => handleCheckOneExpiry(record.id)} size="small">
            <span className="mobile-btn-text">到期</span>
          </Button>
          <Button type="text" icon={<IconSettings />} onClick={() => openTagAssign(record)} size="small">
            <span className="mobile-btn-text">标签</span>
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
      <Title heading={4} style={{ marginBottom: 16 }}>域名管理</Title>
      <Card>
        <div className="filter-bar" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <Input
            prefix={<IconSearch />}
            placeholder="搜索域名"
            style={{ width: 200 }}
            value={keyword}
            onChange={(v) => {
              setKeyword(v)
              setPage(1)
            }}
            allowClear
          />
          <Select
            placeholder="按标签筛选"
            style={{ width: 180 }}
            value={tagFilter}
            onChange={(v) => {
              setTagFilter(v)
              setPage(1)
            }}
            allowClear
          >
            {allTags.map((t) => (
              <Select.Option key={t.id} value={t.id}>
                <Tag color={t.color} size="small">{t.name}</Tag>
              </Select.Option>
            ))}
          </Select>
          <Space>
            <Button type="primary" icon={<IconRefresh />} onClick={handleBatchSync} loading={syncing}>
              <span className="mobile-btn-text">批量同步</span>
            </Button>
            <Button icon={<IconSync />} onClick={handleCheckAllExpiry} loading={checking}>
              <span className="mobile-btn-text">查询到期</span>
            </Button>
            <Button icon={<IconTags />} onClick={() => setTagManagerVisible(true)}>
              <span className="mobile-btn-text">标签管理</span>
            </Button>
          </Space>
          <div style={{ flex: 1 }} />
          {selectedRowKeys.length > 0 && (
            <Space>
              <span style={{ color: 'var(--color-text-3)', fontSize: 13 }}>
                已选 {selectedRowKeys.length} 项
              </span>
              <Popconfirm
                title={`确定删除选中的 ${selectedRowKeys.length} 个域名？`}
                onOk={handleBatchDelete}
              >
                <Button type="primary" status="danger" size="small" icon={<IconDelete />}>
                  批量删除
                </Button>
              </Popconfirm>
            </Space>
          )}
        </div>
        <div className="table-responsive">
          <Table
            columns={columns}
            data={domains}
            rowKey="id"
            loading={loading}
            rowSelection={{
              type: 'checkbox',
              selectedRowKeys,
              onChange: (keys) => setSelectedRowKeys(keys as number[]),
            }}
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

      <TagManager
        visible={tagManagerVisible}
        onClose={() => {
          setTagManagerVisible(false)
          api.get('/tags').then((res) => setAllTags(res.data.data || [])).catch(() => {})
        }}
      />

      {/* Tag assignment modal for individual domains */}
      <Modal
        title="分配标签"
        visible={tagAssignVisible}
        onOk={handleTagAssign}
        onCancel={() => setTagAssignVisible(false)}
        okText="保存"
        cancelText="取消"
      >
        <div style={{ padding: '8px 0' }}>
          {allTags.length === 0 ? (
            <span style={{ color: 'var(--color-text-4)' }}>暂无标签，请先在「标签管理」中创建</span>
          ) : (
            <Checkbox.Group
              direction="vertical"
              value={tagAssignSelected}
              onChange={(v) => setTagAssignSelected(v as number[])}
            >
              {allTags.map((t) => (
                <Checkbox key={t.id} value={t.id}>
                  <Tag color={t.color} size="small" style={{ marginRight: 4 }}>{t.name}</Tag>
                </Checkbox>
              ))}
            </Checkbox.Group>
          )}
        </div>
      </Modal>
    </div>
  )
}