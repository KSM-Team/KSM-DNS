import { useState, useEffect } from 'react'
import {
  Card,
  Table,
  Button,
  Space,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
  Message,
  Popconfirm,
  Tag,
  Tabs,
  Typography,
  Alert,
} from '@arco-design/web-react'
import {
  IconPlus,
  IconEdit,
  IconDelete,
  IconSend,
  IconNotification,
} from '@arco-design/web-react/icon'
import api from '@/api'
import {
  pushSupported,
  pushPermission,
  isStandalone,
  subscribeToPush,
  currentSubscription,
} from '@/utils/push'

const { TabPane } = Tabs
const { Title, Text } = Typography

interface Channel {
  id: number
  name: string
  type: string
  config: string
  enabled: boolean
  created_at: string
}

interface NotifyLog {
  id: number
  channel_id: number
  title: string
  content: string
  status: string
  error: string
  created_at: string
}

interface ConfigForm {
  smtp_host?: string
  smtp_port?: number
  smtp_username?: string
  smtp_password?: string
  from_address?: string
  to_addresses?: string
  bot_token?: string
  chat_id?: string
  vapid_public_key?: string
  vapid_private_key?: string
}

interface PushSub {
  id: number
  endpoint: string
  user_agent: string
  created_at: string
}

export default function Notifications() {
  const [activeTab, setActiveTab] = useState('channels')
  const [channels, setChannels] = useState<Channel[]>([])
  const [logs, setLogs] = useState<NotifyLog[]>([])
  const [loading, setLoading] = useState(false)
  const [channelTotal, setChannelTotal] = useState(0)
  const [channelPage, setChannelPage] = useState(1)
  const [channelPageSize, setChannelPageSize] = useState(20)
  const [logTotal, setLogTotal] = useState(0)
  const [logPage, setLogPage] = useState(1)
  const [logPageSize, setLogPageSize] = useState(20)
  const [modalVisible, setModalVisible] = useState(false)
  const [editing, setEditing] = useState<Channel | null>(null)
  const [form] = Form.useForm()

  // Web Push (PWA) 状态
  const [pushAvailable, setPushAvailable] = useState(false)
  const [pushPerm, setPushPerm] = useState<NotificationPermission | 'unsupported' | ''>('')
  const [isPWA, setIsPWA] = useState(false)
  const [subs, setSubs] = useState<PushSub[]>([])
  const [subLoading, setSubLoading] = useState(false)

  useEffect(() => {
    fetchChannels()
    fetchLogs()
  }, [channelPage, channelPageSize])

  useEffect(() => {
    fetchLogs()
  }, [logPage, logPageSize])

  useEffect(() => {
    refreshPushState()
    fetchSubscriptions()
  }, [])

  const refreshPushState = async () => {
    setPushAvailable(await pushSupported())
    setPushPerm(await pushPermission())
    setIsPWA(isStandalone())
  }

  const fetchSubscriptions = async () => {
    setSubLoading(true)
    try {
      const res = await api.get('/push/subscriptions')
      setSubs(res.data.data || [])
    } catch {
      setSubs([])
    } finally {
      setSubLoading(false)
    }
  }

  const fetchChannels = async () => {
    setLoading(true)
    try {
      const res = await api.get('/notifications/channels', { params: { page: channelPage, page_size: channelPageSize } })
      setChannels(res.data.data || [])
      setChannelTotal(res.data.total || 0)
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '加载通知渠道失败')
    } finally {
      setLoading(false)
    }
  }

  const fetchLogs = async () => {
    try {
      const res = await api.get('/notifications/logs', { params: { page: logPage, page_size: logPageSize } })
      setLogs(res.data.data || [])
      setLogTotal(res.data.total || 0)
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '加载日志失败')
    }
  }

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ enabled: true })
    setModalVisible(true)
  }

  const openEdit = (channel: Channel) => {
    setEditing(channel)
    let cfg: ConfigForm = {}
    try {
      cfg = JSON.parse(channel.config || '{}')
    } catch {}
    form.setFieldsValue({
      name: channel.name,
      type: channel.type,
      enabled: channel.enabled,
      ...cfg,
    })
    setModalVisible(true)
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validate()
      const { name, type, enabled, ...rest } = values
      const config: ConfigForm = {}
      if (type === 'email') {
        config.smtp_host = rest.smtp_host
        config.smtp_port = rest.smtp_port
        config.smtp_username = rest.smtp_username
        config.smtp_password = rest.smtp_password
        config.from_address = rest.from_address
        config.to_addresses = rest.to_addresses
      } else if (type === 'telegram') {
        config.bot_token = rest.bot_token
        config.chat_id = rest.chat_id
      } else if (type === 'webpush') {
        config.vapid_public_key = rest.vapid_public_key
        config.vapid_private_key = rest.vapid_private_key
      }

      if (editing) {
        await api.put(`/notifications/channels/${editing.id}`, {
          name,
          enabled,
          config,
        })
        Message.success('渠道更新成功')
      } else {
        await api.post('/notifications/channels', {
          name,
          type,
          enabled,
          config,
        })
        Message.success('渠道添加成功')
      }
      setModalVisible(false)
      fetchChannels()
    } catch (e: any) {
      if (e?.response?.data?.error) {
        Message.error(e.response.data.error)
      }
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/notifications/channels/${id}`)
      Message.success('已删除')
      fetchChannels()
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '删除失败')
    }
  }

  const handleTest = async (id: number) => {
    try {
      await api.post(`/notifications/channels/${id}/test`)
      Message.success('测试通知发送成功')
      fetchLogs()
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '测试发送失败')
      fetchLogs()
    }
  }

  const handleSubscribe = async () => {
    try {
      const res = await api.get('/push/vapid-public-key')
      const publicKey = res.data.public_key
      const sub = await subscribeToPush(publicKey)
      if (!sub) {
        Message.warning('未创建订阅')
        return
      }
      await api.post('/push/subscribe', {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.toJSON().keys?.p256dh,
          auth: sub.toJSON().keys?.auth,
        },
        user_agent: navigator.userAgent,
      })
      Message.success('推送订阅成功')
      refreshPushState()
      fetchSubscriptions()
    } catch (e: any) {
      Message.error(e?.message || e?.response?.data?.error || '订阅失败')
    }
  }

  const handleUnsubscribe = async () => {
    try {
      const sub = await currentSubscription()
      if (sub) {
        await sub.unsubscribe()
        await api.post('/push/unsubscribe', { endpoint: sub.endpoint })
      }
      // 清理所有本机订阅记录
      await Promise.all(subs.map((s) => api.post('/push/unsubscribe', { endpoint: s.endpoint }).catch(() => {})))
      Message.success('已取消推送订阅')
      refreshPushState()
      fetchSubscriptions()
    } catch (e: any) {
      Message.error(e?.message || e?.response?.data?.error || '取消订阅失败')
    }
  }

  const handleTestPush = async () => {
    try {
      await api.post('/push/test')
      Message.success('测试推送已发送')
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '测试推送发送失败')
    }
  }

  const channelColumns = [
    { title: '名称', dataIndex: 'name' },
    {
      title: '类型',
      dataIndex: 'type',
      className: 'col-hide-mobile',
      render: (t: string) => (
        <Tag color={t === 'email' ? 'blue' : t === 'telegram' ? 'purple' : 'green'}>
          {t === 'email' ? '邮件' : t === 'telegram' ? 'Telegram' : 'Web Push'}
        </Tag>
      ),
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      render: (v: boolean) => <Tag color={v ? 'green' : 'gray'}>{v ? '已启用' : '已禁用'}</Tag>,
    },
    {
      title: '操作',
      render: (_: any, record: Channel) => (
        <Space>
          <Button type="text" icon={<IconSend />} onClick={() => handleTest(record.id)} size="small">
            <span className="mobile-btn-text">测试</span>
          </Button>
          <Button type="text" icon={<IconEdit />} onClick={() => openEdit(record)} size="small">
            <span className="mobile-btn-text">编辑</span>
          </Button>
          <Popconfirm title="确定删除此渠道？" onOk={() => handleDelete(record.id)}>
            <Button type="text" status="danger" icon={<IconDelete />} size="small">
              <span className="mobile-btn-text">删除</span>
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const logColumns = [
    { title: '标题', dataIndex: 'title', width: 180 },
    { title: '内容', dataIndex: 'content', ellipsis: true },
    {
      title: '状态',
      dataIndex: 'status',
      width: 80,
      render: (s: string) => <Tag color={s === 'sent' ? 'green' : 'red'}>{s === 'sent' ? '成功' : '失败'}</Tag>,
    },
    { title: '错误', dataIndex: 'error', ellipsis: true, width: 200 },
    { title: '时间', dataIndex: 'created_at', width: 180, render: (t: string) => t?.slice(0, 19).replace('T', ' ') },
  ]

  return (
    <div>
      <Title heading={4} style={{ marginBottom: 16 }}>通知管理</Title>
      <Tabs activeTab={activeTab} onChange={setActiveTab}>
        <TabPane key="channels" title="通知渠道">
          <Card>
            <div style={{ marginBottom: 16 }}>
              <Button type="primary" icon={<IconPlus />} onClick={openCreate}>
                <span className="mobile-btn-text">添加渠道</span>
              </Button>
            </div>
            <div className="table-responsive">
              <Table
                columns={channelColumns}
                data={channels}
                rowKey="id"
                pagination={{
                  current: channelPage,
                  pageSize: channelPageSize,
                  total: channelTotal,
                  showTotal: true,
                  onChange: (p, ps) => {
                    setChannelPage(p)
                    setChannelPageSize(ps)
                  },
                }}
                loading={loading}
              />
            </div>
          </Card>
        </TabPane>
        <TabPane key="logs" title="发送日志">
          <Card>
            <div className="table-responsive">
              <Table
                columns={logColumns}
                data={logs}
                rowKey="id"
                pagination={{
                  current: logPage,
                  pageSize: logPageSize,
                  total: logTotal,
                  showTotal: true,
                  onChange: (p, ps) => {
                    setLogPage(p)
                    setLogPageSize(ps)
                  },
                }}
              />
            </div>
          </Card>
        </TabPane>
        <TabPane key="push" title="PWA 推送">
          <Card>
            <Space direction="vertical" style={{ width: '100%' }} size="large">
              <Alert
                type="info"
                title="苹果 Web Push 三大原则"
                content={
                  <div style={{ lineHeight: 1.8 }}>
                    <div>1. 必须作为主屏幕应用安装运行（standalone 模式），本应用已配置 manifest 的 standalone 显示。</div>
                    <div>2. 订阅必须由用户手势触发，请点击下方「订阅推送」按钮完成授权。</div>
                    <div>3. 必须通过 HTTPS 提供服务并配置有效的 VAPID 密钥（可在「系统设置」中生成）。</div>
                  </div>
                }
              />
              <Space wrap>
                <Button type="primary" icon={<IconNotification />} onClick={handleSubscribe}>
                  <span className="mobile-btn-text">订阅推送</span>
                </Button>
                <Button onClick={handleUnsubscribe}><span className="mobile-btn-text">取消订阅</span></Button>
                <Button type="outline" icon={<IconSend />} onClick={handleTestPush}>
                  <span className="mobile-btn-text">发送测试推送</span>
                </Button>
              </Space>
              <Space wrap size="large">
                <Text>推送支持：{pushAvailable ? <Tag color="green">支持</Tag> : <Tag color="red">不支持</Tag>}</Text>
                <Text>
                  通知权限：
                  {pushPerm === 'granted' ? <Tag color="green">已授权</Tag> : pushPerm === 'denied' ? <Tag color="red">已拒绝</Tag> : pushPerm === 'unsupported' ? <Tag color="gray">不支持</Tag> : <Tag color="orange">未授权</Tag>}
                </Text>
                <Text>
                  安装状态：
                  {isPWA ? <Tag color="green">已安装为应用</Tag> : <Tag color="orange">浏览器访问</Tag>}
                </Text>
              </Space>
              <div className="table-responsive">
                <Table
                  columns={[
                    { title: '浏览器', dataIndex: 'user_agent', ellipsis: true },
                    { title: '订阅时间', dataIndex: 'created_at', width: 180, render: (t: string) => t?.slice(0, 19).replace('T', ' ') },
                    {
                      title: '操作',
                      width: 100,
                      render: (_: any, record: PushSub) => (
                        <Popconfirm title="取消此设备订阅？" onOk={() => api.post('/push/unsubscribe', { endpoint: record.endpoint }).then(() => fetchSubscriptions())}>
                          <Button type="text" status="danger" size="small">
                            <span className="mobile-btn-text">删除</span>
                          </Button>
                        </Popconfirm>
                      ),
                    },
                  ]}
                  data={subs}
                  rowKey="id"
                  loading={subLoading}
                  pagination={false}
                />
              </div>
            </Space>
          </Card>
        </TabPane>
      </Tabs>

      <Modal
        title={editing ? '编辑渠道' : '添加渠道'}
        visible={modalVisible}
        onOk={handleSubmit}
        onCancel={() => setModalVisible(false)}
        autoFocus={false}
        focusLock
      >
        <Form form={form} layout="vertical">
          <Form.Item label="名称" field="name" rules={[{ required: true, message: '请输入渠道名称' }]}>
            <Input placeholder="例如：运维邮件通知" />
          </Form.Item>
          <Form.Item label="类型" field="type" rules={[{ required: true, message: '请选择渠道类型' }]}>
            <Select disabled={!!editing}>
              <Select.Option value="email">邮件</Select.Option>
              <Select.Option value="telegram">Telegram</Select.Option>
              <Select.Option value="webpush">Web Push</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item shouldUpdate noStyle>
            {(values: any) => {
              if (values.type === 'email') {
                return (
                  <>
                    <Form.Item label="SMTP 服务器" field="smtp_host" rules={[{ required: true, message: '请输入 SMTP 服务器' }]}>
                      <Input placeholder="例如：smtp.gmail.com" />
                    </Form.Item>
                    <Form.Item label="SMTP 端口" field="smtp_port">
                      <InputNumber min={1} max={65535} placeholder="465" style={{ width: '100%' }} />
                    </Form.Item>
                    <Form.Item label="SMTP 用户名" field="smtp_username">
                      <Input placeholder="登录用户名" />
                    </Form.Item>
                    <Form.Item label="SMTP 密码" field="smtp_password">
                      <Input.Password placeholder="登录密码" />
                    </Form.Item>
                    <Form.Item label="发件人地址" field="from_address" rules={[{ required: true, message: '请输入发件人地址' }]}>
                      <Input placeholder="例如：noreply@example.com" />
                    </Form.Item>
                    <Form.Item label="收件人地址" field="to_addresses" rules={[{ required: true, message: '请输入收件人地址' }]}>
                      <Input placeholder="多个地址用逗号分隔" />
                    </Form.Item>
                  </>
                )
              }
              if (values.type === 'telegram') {
                return (
                  <>
                    <Form.Item label="Bot Token" field="bot_token" rules={[{ required: true, message: '请输入 Bot Token' }]}>
                      <Input.Password placeholder="Telegram Bot Token" />
                    </Form.Item>
                    <Form.Item label="Chat ID" field="chat_id" rules={[{ required: true, message: '请输入 Chat ID' }]}>
                      <Input placeholder="接收消息的 Chat ID" />
                    </Form.Item>
                  </>
                )
              }
              if (values.type === 'webpush') {
                return (
                  <>
                    <Alert
                      type="info"
                      content="Web Push 渠道会向所有已订阅的浏览器推送系统通知。VAPID 密钥默认自动生成，可在「系统设置」中查看或重新生成。"
                      style={{ marginBottom: 16 }}
                    />
                    <Form.Item label="VAPID 公钥" field="vapid_public_key">
                      <Input placeholder="可选，留空则使用系统设置中的 VAPID 公钥" />
                    </Form.Item>
                    <Form.Item label="VAPID 私钥" field="vapid_private_key">
                      <Input.Password placeholder="可选，留空则使用系统设置中的 VAPID 私钥" />
                    </Form.Item>
                  </>
                )
              }
              return null
            }}
          </Form.Item>
          <Form.Item label="启用" field="enabled" triggerPropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
