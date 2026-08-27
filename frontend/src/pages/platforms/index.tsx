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
} from '@arco-design/web-react'
import {
  IconPlus,
  IconSync,
  IconDelete,
  IconEdit,
  IconSearch,
  IconRefresh,
} from '@arco-design/web-react/icon'
import api from '@/api'
import { providerLogo, providerLabel, providerColor } from '@/utils/provider'

const { Title } = Typography

interface Platform {
  id: number
  name: string
  type: string
  created_at: string
  domain_count?: number
}

export default function Platforms() {
  const [platforms, setPlatforms] = useState<Platform[]>([])
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [keyword, setKeyword] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [editing, setEditing] = useState<Platform | null>(null)
  const [form] = Form.useForm()

  useEffect(() => {
    fetchPlatforms()
  }, [page, pageSize, keyword])

  const fetchPlatforms = async () => {
    setLoading(true)
    try {
      const res = await api.get('/platforms', { params: { page, page_size: pageSize, keyword } })
      setPlatforms(res.data.data || [])
      setTotal(res.data.total || 0)
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '加载平台失败')
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
        Message.warning(`同步完成：新增 ${res.data.added} 个域名。${errs.length} 个平台失败：${errs.join('；')}`)
      } else {
        Message.success(`批量同步完成：新增 ${res.data.added} 个域名，共 ${res.data.total} 个（${res.data.platforms} 个平台）`)
      }
      fetchPlatforms()
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '批量同步失败')
    } finally {
      setSyncing(false)
    }
  }

  const handleCreate = () => {
    setEditing(null)
    form.resetFields()
    setModalVisible(true)
  }

  const handleEdit = (platform: Platform) => {
    setEditing(platform)
    form.setFieldsValue({ name: platform.name, type: platform.type })
    setModalVisible(true)
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validate()
      const credentials: Record<string, string> = {}
      if (values.type === 'cloudflare') {
        credentials.api_token = values.api_token
      } else if (values.type === 'spaceship') {
        credentials.api_key = values.api_key
        credentials.api_secret = values.api_secret
      } else if (values.type === 'namesilo') {
        credentials.api_key = values.api_key
      } else if (values.type === 'aliyun') {
        credentials.access_key_id = values.access_key_id
        credentials.access_key_secret = values.access_key_secret
      } else if (values.type === 'tencent') {
        credentials.secret_id = values.secret_id
        credentials.secret_key = values.secret_key
      } else if (values.type === 'porkbun') {
        credentials.api_key = values.api_key
        credentials.secret_key = values.secret_key
      }

      if (editing) {
        await api.put(`/platforms/${editing.id}`, { name: values.name, credentials })
        Message.success('平台更新成功')
      } else {
        await api.post('/platforms', { name: values.name, type: values.type, credentials })
        Message.success('平台添加成功')
      }
      setModalVisible(false)
      fetchPlatforms()
    } catch (e: any) {
      if (e?.response?.data?.error) {
        Message.error(e.response.data.error)
      } else if (e?.response?.data?.detail) {
        Message.error(typeof e.response.data.detail === 'string' ? e.response.data.detail : '请求参数错误')
      } else {
        Message.error('操作失败，请重试')
      }
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/platforms/${id}`)
      Message.success('已删除')
      fetchPlatforms()
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '删除失败')
    }
  }

  const handleSync = async (id: number) => {
    setLoading(true)
    try {
      const res = await api.post(`/platforms/${id}/sync`)
      Message.success(`同步完成，新增 ${res.data.added} 个域名，共 ${res.data.total} 个`)
      fetchPlatforms()
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '同步失败')
    } finally {
      setLoading(false)
    }
  }

  const columns = [
    {
      title: '平台',
      dataIndex: 'name',
      render: (name: string, record: Platform) => (
        <Space>
          <img src={providerLogo[record.type]} alt={record.type} width={20} height={20} />
          <span>{name}</span>
        </Space>
      ),
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 130,
      className: 'col-hide-mobile',
      render: (type: string) => (
        <Tag color={providerColor[type]}>{providerLabel[type] || type}</Tag>
      ),
    },
    {
      title: '域名数量',
      dataIndex: 'domain_count',
      width: 100,
      render: (count: number) => <Tag color={count ? 'green' : 'gray'}>{count ?? 0} 个</Tag>,
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 120,
      className: 'col-hide-mobile',
      render: (t: string) => t?.slice(0, 10),
    },
    {
      title: '操作',
      width: 240,
      render: (_: any, record: Platform) => (
        <Space>
          <Button type="text" icon={<IconSync />} onClick={() => handleSync(record.id)} size="small">
            <span className="mobile-btn-text">同步域名</span>
          </Button>
          <Button type="text" icon={<IconEdit />} onClick={() => handleEdit(record)} size="small">
            <span className="mobile-btn-text">编辑</span>
          </Button>
          <Popconfirm title="确定删除此平台？" onOk={() => handleDelete(record.id)}>
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
      <Title heading={4} style={{ marginBottom: 16 }}>DNS 平台管理</Title>
      <Card>
        <div className="filter-bar" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <Input
            prefix={<IconSearch />}
            placeholder="搜索平台"
            style={{ width: 260 }}
            value={keyword}
            onChange={(v) => {
              setKeyword(v)
              setPage(1)
            }}
            allowClear
          />
          <Space>
            <Button type="primary" icon={<IconPlus />} onClick={handleCreate}>
              添加平台
            </Button>
            <Button icon={<IconRefresh />} onClick={handleBatchSync} loading={syncing}>
              <span className="mobile-btn-text">批量同步</span>
            </Button>
          </Space>
        </div>
        <div className="table-responsive">
          <Table
            columns={columns}
            data={platforms}
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

      <Modal
        title={editing ? '编辑平台' : '添加平台'}
        visible={modalVisible}
        onOk={handleSubmit}
        onCancel={() => setModalVisible(false)}
        autoFocus={false}
        focusLock
      >
        <Form form={form} layout="vertical">
          <Form.Item label="名称" field="name" rules={[{ required: true, message: '请输入平台名称' }]}>
            <Input placeholder="例如：我的Cloudflare" />
          </Form.Item>
          <Form.Item label="类型" field="type" rules={[{ required: true, message: '请选择平台类型' }]}>
            <Select disabled={!!editing}>
              <Select.Option value="cloudflare">Cloudflare</Select.Option>
              <Select.Option value="spaceship">Spaceship</Select.Option>
              <Select.Option value="namesilo">Namesilo</Select.Option>
              <Select.Option value="aliyun">阿里云 (Aliyun)</Select.Option>
              <Select.Option value="tencent">腾讯云 (Tencent)</Select.Option>
              <Select.Option value="porkbun">Porkbun</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item shouldUpdate noStyle>
            {(values: any) => {
              if (values.type === 'cloudflare') {
                return (
                  <Form.Item label="API Token" field="api_token" rules={[{ required: true, message: '请输入 API Token' }]}>
                    <Input.Password placeholder="Cloudflare API Token" />
                  </Form.Item>
                )
              }
              if (values.type === 'spaceship') {
                return (
                  <>
                    <Form.Item label="API Key" field="api_key" rules={[{ required: true, message: '请输入 API Key' }]}>
                      <Input.Password placeholder="Spaceship API Key" />
                    </Form.Item>
                    <Form.Item label="API Secret" field="api_secret" rules={[{ required: true, message: '请输入 API Secret' }]}>
                      <Input.Password placeholder="Spaceship API Secret" />
                    </Form.Item>
                  </>
                )
              }
              if (values.type === 'namesilo') {
                return (
                  <Form.Item label="API Key" field="api_key" rules={[{ required: true, message: '请输入 API Key' }]}>
                    <Input.Password placeholder="Namesilo API Key" />
                  </Form.Item>
                )
              }
              if (values.type === 'aliyun') {
                return (
                  <>
                    <Form.Item label="AccessKey ID" field="access_key_id" rules={[{ required: true, message: '请输入 AccessKey ID' }]}>
                      <Input.Password placeholder="阿里云 AccessKey ID" />
                    </Form.Item>
                    <Form.Item label="AccessKey Secret" field="access_key_secret" rules={[{ required: true, message: '请输入 AccessKey Secret' }]}>
                      <Input.Password placeholder="阿里云 AccessKey Secret" />
                    </Form.Item>
                  </>
                )
              }
              if (values.type === 'tencent') {
                return (
                  <>
                    <Form.Item label="SecretId" field="secret_id" rules={[{ required: true, message: '请输入 SecretId' }]}>
                      <Input.Password placeholder="腾讯云 SecretId" />
                    </Form.Item>
                    <Form.Item label="SecretKey" field="secret_key" rules={[{ required: true, message: '请输入 SecretKey' }]}>
                      <Input.Password placeholder="腾讯云 SecretKey" />
                    </Form.Item>
                  </>
                )
              }
              if (values.type === 'porkbun') {
                return (
                  <>
                    <Form.Item label="API Key" field="api_key" rules={[{ required: true, message: '请输入 API Key' }]}>
                      <Input.Password placeholder="Porkbun API Key" />
                    </Form.Item>
                    <Form.Item label="Secret Key" field="secret_key" rules={[{ required: true, message: '请输入 Secret Key' }]}>
                      <Input.Password placeholder="Porkbun Secret Key" />
                    </Form.Item>
                  </>
                )
              }
              return null
            }}
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
