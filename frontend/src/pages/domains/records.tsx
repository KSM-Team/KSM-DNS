import { useState, useEffect } from 'react'
import {
  Card,
  Table,
  Button,
  Space,
  Modal,
  Form,
  Input,
  Select,
  Message,
  Popconfirm,
  Tag,
  Typography,
  InputNumber,
  Switch,
} from '@arco-design/web-react'
import {
  IconPlus,
  IconSync,
  IconDelete,
  IconEdit,
  IconLeft,
  IconSearch,
} from '@arco-design/web-react/icon'
import { useParams, useNavigate } from 'react-router-dom'
import api from '@/api'
import { providerLogo } from '@/utils/provider'

const { Title } = Typography

interface Domain {
  id: number
  platform_id: number
  domain: string
  status: string
  platform?: { id: number; name: string; type: string }
}

interface DNSRecord {
  id: number
  domain_id: number
  name: string
  type: string
  value: string
  ttl: number
  proxied: boolean
  platform_record_id: string
  status: string
}

const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA', 'PTR']

export default function DomainRecords() {
  const { id } = useParams()
  const navigate = useNavigate()
  const domainId = Number(id)

  const [domain, setDomain] = useState<Domain | null>(null)
  const [records, setRecords] = useState<DNSRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [keyword, setKeyword] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [selectedKeys, setSelectedKeys] = useState<number[]>([])
  const [modalVisible, setModalVisible] = useState(false)
  const [editing, setEditing] = useState<DNSRecord | null>(null)
  const [form] = Form.useForm()

  useEffect(() => {
    if (domainId) {
      fetchDomain()
      fetchRecords()
    }
  }, [domainId, page, pageSize, keyword, typeFilter])

  const fetchDomain = async () => {
    try {
      const res = await api.get('/domains', { params: { page: 1, page_size: 200 } })
      const list: Domain[] = res.data.data || []
      setDomain(list.find((d) => d.id === domainId) || null)
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '加载域名失败')
    }
  }

  const fetchRecords = async () => {
    setLoading(true)
    try {
      const res = await api.get(`/domains/${domainId}/records`, {
        params: { page, page_size: pageSize, keyword, type: typeFilter },
      })
      setRecords(res.data.data || [])
      setTotal(res.data.total || 0)
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '加载记录失败')
    } finally {
      setLoading(false)
    }
  }

  const handleSync = async () => {
    setLoading(true)
    try {
      const res = await api.post(`/domains/${domainId}/sync-records`)
      Message.success(`同步完成，共 ${res.data.count} 条记录`)
      fetchRecords()
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '同步失败')
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ ttl: 300, proxied: false })
    setModalVisible(true)
  }

  const handleEdit = (record: DNSRecord) => {
    setEditing(record)
    form.setFieldsValue({
      name: record.name,
      type: record.type,
      value: record.value,
      ttl: record.ttl,
      proxied: record.proxied,
    })
    setModalVisible(true)
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validate()
      if (editing) {
        await api.put(`/records/${editing.id}`, values)
        Message.success('记录更新成功')
      } else {
        await api.post(`/domains/${domainId}/records`, values)
        Message.success('记录创建成功')
      }
      setModalVisible(false)
      fetchRecords()
    } catch (e: any) {
      if (e?.response?.data?.error) {
        Message.error(e.response.data.error)
      }
    }
  }

  const handleDelete = async (recordId: number) => {
    try {
      await api.delete(`/records/${recordId}`)
      Message.success('已删除')
      fetchRecords()
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '删除失败')
    }
  }

  const handleBatchDelete = async () => {
    if (!selectedKeys.length) return
    try {
      await Promise.all(selectedKeys.map((rid) => api.delete(`/records/${rid}`)))
      Message.success(`已批量删除 ${selectedKeys.length} 条记录`)
      setSelectedKeys([])
      fetchRecords()
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '批量删除失败')
    }
  }

  const columns = [
    { title: '名称', dataIndex: 'name', width: 200 },
    {
      title: '类型',
      dataIndex: 'type',
      width: 90,
      render: (t: string) => <Tag color="arcoblue">{t}</Tag>,
    },
    { title: '值', dataIndex: 'value', ellipsis: true },
    { title: 'TTL', dataIndex: 'ttl', width: 80, className: 'col-hide-mobile' },
    {
      title: '代理',
      dataIndex: 'proxied',
      width: 70,
      className: 'col-hide-mobile',
      render: (v: boolean) => (v ? <Tag color="orange">是</Tag> : <Tag>否</Tag>),
    },
    {
      title: '操作',
      width: 120,
      render: (_: any, record: DNSRecord) => (
        <Space>
          <Button type="text" icon={<IconEdit />} onClick={() => handleEdit(record)} size="small" />
          <Popconfirm title="确定删除？" onOk={() => handleDelete(record.id)}>
            <Button type="text" status="danger" icon={<IconDelete />} size="small" />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<IconLeft />} onClick={() => navigate('/domains')}>
          <span className="mobile-btn-text">返回</span>
        </Button>
        <Title heading={4} style={{ margin: 0 }}>DNS 解析管理</Title>
      </Space>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          {domain?.platform && (
            <img src={providerLogo[domain.platform.type]} alt={domain.platform.type} width={22} height={22} />
          )}
          <Typography.Text bold style={{ fontSize: 16 }}>
            {domain?.domain || `域名 #${domainId}`}
          </Typography.Text>
          <span style={{ color: 'var(--color-text-3)' }}>{domain?.platform?.name}</span>
        </div>

        <div className="filter-bar" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <Input
            prefix={<IconSearch />}
            placeholder="搜索记录名称或值"
            style={{ width: 260 }}
            value={keyword}
            onChange={(v) => {
              setKeyword(v)
              setPage(1)
            }}
            allowClear
          />
          <Select
            placeholder="记录类型"
            style={{ width: 140 }}
            value={typeFilter || undefined}
            onChange={(v) => {
              setTypeFilter(v || '')
              setPage(1)
            }}
            allowClear
          >
            {RECORD_TYPES.map((t) => (
              <Select.Option key={t} value={t}>{t}</Select.Option>
            ))}
          </Select>
          <Space>
            <Button type="primary" icon={<IconPlus />} onClick={handleCreate}>
              <span className="mobile-btn-text">添加记录</span>
            </Button>
            <Button icon={<IconSync />} onClick={handleSync}>
              <span className="mobile-btn-text">同步记录</span>
            </Button>
            <Popconfirm title={`确定批量删除选中的 ${selectedKeys.length} 条记录？`} onOk={handleBatchDelete}>
              <Button
                status="danger"
                icon={<IconDelete />}
                disabled={!selectedKeys.length}
              >
                <span className="mobile-btn-text">批量删除 ({selectedKeys.length})</span>
              </Button>
            </Popconfirm>
          </Space>
        </div>

        <Table
          columns={columns}
          data={records}
          rowKey="id"
          loading={loading}
          rowSelection={{ selectedRowKeys: selectedKeys, onChange: (keys) => setSelectedKeys(keys as number[]) }}
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
      </Card>

      <Modal
        title={editing ? '编辑记录' : '添加记录'}
        visible={modalVisible}
        onOk={handleSubmit}
        onCancel={() => setModalVisible(false)}
        autoFocus={false}
        focusLock
      >
        <Form form={form} layout="vertical">
          <Form.Item label="名称" field="name" rules={[{ required: true, message: '请输入记录名称' }]}>
            <Input placeholder="例如：www 或 @" />
          </Form.Item>
          <Form.Item label="类型" field="type" rules={[{ required: true, message: '请选择记录类型' }]}>
            <Select>
              {RECORD_TYPES.map((t) => (
                <Select.Option key={t} value={t}>{t}</Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item label="值" field="value" rules={[{ required: true, message: '请输入记录值' }]}>
            <Input placeholder="记录值" />
          </Form.Item>
          <Form.Item label="TTL (秒)" field="ttl">
            <InputNumber min={60} max={86400} />
          </Form.Item>
          <Form.Item label="Cloudflare 代理" field="proxied" triggerPropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
