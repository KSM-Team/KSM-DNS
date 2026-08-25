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
} from '@arco-design/web-react'
import {
  IconPlus,
  IconEdit,
  IconDelete,
  IconThunderbolt,
  IconUndo,
  IconRefresh,
} from '@arco-design/web-react/icon'
import api from '@/api'

const { TabPane } = Tabs
const { Title } = Typography

interface Domain {
  id: number
  domain: string
}

interface DNSRecord {
  id: number
  domain_id: number
  name: string
  type: string
  value: string
}

interface Channel {
  id: number
  name: string
  enabled: boolean
}

interface Rule {
  id: number
  name: string
  domain_id: number
  record_id: number
  check_type: string
  check_target: string
  check_interval: number
  check_timeout: number
  retry_count: number
  action_type: string
  backup_value: string
  original_value: string
  notify_channels: string
  enabled: boolean
  status: string
  fail_count: number
  last_check_at: string
  domain_info?: Domain
  record_info?: DNSRecord
}

interface FailoverLog {
  id: number
  rule_id: number
  event: string
  message: string
  old_value: string
  new_value: string
  created_at: string
}

export default function Failover() {
  const [activeTab, setActiveTab] = useState('rules')
  const [rules, setRules] = useState<Rule[]>([])
  const [logs, setLogs] = useState<FailoverLog[]>([])
  const [domains, setDomains] = useState<Domain[]>([])
  const [records, setRecords] = useState<DNSRecord[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(false)
  const [ruleTotal, setRuleTotal] = useState(0)
  const [rulePage, setRulePage] = useState(1)
  const [rulePageSize, setRulePageSize] = useState(20)
  const [logTotal, setLogTotal] = useState(0)
  const [logPage, setLogPage] = useState(1)
  const [logPageSize, setLogPageSize] = useState(20)
  const [modalVisible, setModalVisible] = useState(false)
  const [editing, setEditing] = useState<Rule | null>(null)
  const [form] = Form.useForm()

  useEffect(() => {
    fetchRules()
    fetchLogs()
    fetchDomains()
    fetchChannels()
  }, [rulePage, rulePageSize])

  useEffect(() => {
    fetchLogs()
  }, [logPage, logPageSize])

  const fetchRules = async () => {
    setLoading(true)
    try {
      const res = await api.get('/failover/rules', { params: { page: rulePage, page_size: rulePageSize } })
      setRules(res.data.data || [])
      setRuleTotal(res.data.total || 0)
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '加载容灾规则失败')
    } finally {
      setLoading(false)
    }
  }

  const fetchLogs = async () => {
    try {
      const res = await api.get('/failover/logs', { params: { page: logPage, page_size: logPageSize } })
      setLogs(res.data.data || [])
      setLogTotal(res.data.total || 0)
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '加载日志失败')
    }
  }

  const fetchDomains = async () => {
    try {
      const res = await api.get('/domains', { params: { page: 1, page_size: 200 } })
      setDomains(res.data.data || [])
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '加载域名失败')
    }
  }

  const fetchChannels = async () => {
    try {
      const res = await api.get('/notifications/channels', { params: { page: 1, page_size: 200 } })
      setChannels(res.data.data || [])
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '加载通知渠道失败')
    }
  }

  const fetchRecords = async (domainId: number) => {
    try {
      const res = await api.get(`/domains/${domainId}/records`, { params: { page: 1, page_size: 200 } })
      setRecords(res.data.data || [])
    } catch {
      setRecords([])
    }
  }

  const openCreate = () => {
    setEditing(null)
    setRecords([])
    form.resetFields()
    form.setFieldsValue({
      check_type: 'tcp',
      check_interval: 60,
      check_timeout: 5,
      retry_count: 3,
      action_type: 'modify',
      enabled: true,
      notify_channels: [],
    })
    setModalVisible(true)
  }

  const openEdit = (rule: Rule) => {
    setEditing(rule)
    let channelIds: number[] = []
    try {
      channelIds = JSON.parse(rule.notify_channels || '[]')
    } catch {}
    form.setFieldsValue({
      name: rule.name,
      domain_id: rule.domain_id,
      record_id: rule.record_id,
      check_type: rule.check_type,
      check_target: rule.check_target,
      check_interval: rule.check_interval,
      check_timeout: rule.check_timeout,
      retry_count: rule.retry_count,
      action_type: rule.action_type,
      backup_value: rule.backup_value,
      enabled: rule.enabled,
      notify_channels: channelIds,
    })
    fetchRecords(rule.domain_id)
    setModalVisible(true)
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validate()
      if (editing) {
        await api.put(`/failover/rules/${editing.id}`, values)
        Message.success('规则更新成功')
      } else {
        await api.post('/failover/rules', values)
        Message.success('规则创建成功')
      }
      setModalVisible(false)
      fetchRules()
    } catch (e: any) {
      if (e?.response?.data?.error) {
        Message.error(e.response.data.error)
      }
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/failover/rules/${id}`)
      Message.success('已删除')
      fetchRules()
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '删除失败')
    }
  }

  const handleTrigger = async (id: number) => {
    try {
      await api.post(`/failover/rules/${id}/trigger`)
      Message.success('已触发切换')
      fetchRules()
      fetchLogs()
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '触发失败')
    }
  }

  const handleRecover = async (id: number) => {
    try {
      await api.post(`/failover/rules/${id}/recover`)
      Message.success('已执行恢复')
      fetchRules()
      fetchLogs()
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '恢复失败')
    }
  }

  const ruleColumns = [
    { title: '名称', dataIndex: 'name' },
    {
      title: '域名',
      dataIndex: 'domain_info',
      render: (d: Domain) => d?.domain || '-',
    },
    {
      title: '记录',
      dataIndex: 'record_info',
      render: (r: DNSRecord) => (r ? `${r.name} (${r.type})` : '-'),
    },
    {
      title: '检测',
      render: (_: any, record: Rule) => (
        <Space size={4}>
          <Tag>{record.check_type.toUpperCase()}</Tag>
          <span style={{ fontSize: 12 }}>{record.check_target}</span>
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (s: string) => (
        <Tag color={s === 'normal' ? 'green' : s === 'triggered' ? 'red' : 'orange'}>
          {s === 'normal' ? '正常' : s === 'triggered' ? '已切换' : '恢复中'}
        </Tag>
      ),
    },
    {
      title: '失败次数',
      dataIndex: 'fail_count',
      width: 80,
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      width: 70,
      render: (v: boolean) => <Tag color={v ? 'green' : 'gray'}>{v ? '是' : '否'}</Tag>,
    },
    {
      title: '操作',
      width: 260,
      render: (_: any, record: Rule) => (
        <Space>
          {record.status === 'triggered' ? (
            <Button type="text" icon={<IconUndo />} onClick={() => handleRecover(record.id)} size="small">
              恢复
            </Button>
          ) : (
            <Button type="text" icon={<IconThunderbolt />} onClick={() => handleTrigger(record.id)} size="small">
              触发
            </Button>
          )}
          <Button type="text" icon={<IconEdit />} onClick={() => openEdit(record)} size="small">
            编辑
          </Button>
          <Popconfirm title="确定删除此规则？" onOk={() => handleDelete(record.id)}>
            <Button type="text" status="danger" icon={<IconDelete />} size="small">
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const logColumns = [
    {
      title: '事件',
      dataIndex: 'event',
      width: 100,
      render: (e: string) => <Tag color={e === 'triggered' ? 'red' : 'green'}>{e === 'triggered' ? '触发' : '恢复'}</Tag>,
    },
    { title: '内容', dataIndex: 'message', ellipsis: true },
    { title: '原值', dataIndex: 'old_value', ellipsis: true, width: 160 },
    { title: '新值', dataIndex: 'new_value', ellipsis: true, width: 160 },
    { title: '时间', dataIndex: 'created_at', width: 180, render: (t: string) => t?.slice(0, 19).replace('T', ' ') },
  ]

  return (
    <div>
      <Title heading={4} style={{ marginBottom: 16 }}>容灾切换</Title>
      <Tabs activeTab={activeTab} onChange={setActiveTab}>
        <TabPane key="rules" title="容灾规则">
          <Card>
            <div style={{ marginBottom: 16 }}>
              <Space>
                <Button type="primary" icon={<IconPlus />} onClick={openCreate}>
                  添加规则
                </Button>
                <Button icon={<IconRefresh />} onClick={fetchRules}>
                  刷新
                </Button>
              </Space>
            </div>
            <Table
              columns={ruleColumns}
              data={rules}
              rowKey="id"
              pagination={{
                current: rulePage,
                pageSize: rulePageSize,
                total: ruleTotal,
                showTotal: true,
                onChange: (p, ps) => {
                  setRulePage(p)
                  setRulePageSize(ps)
                },
              }}
              loading={loading}
            />
          </Card>
        </TabPane>
        <TabPane key="logs" title="切换日志">
          <Card>
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
          </Card>
        </TabPane>
      </Tabs>

      <Modal
        title={editing ? '编辑规则' : '添加规则'}
        visible={modalVisible}
        onOk={handleSubmit}
        onCancel={() => setModalVisible(false)}
        autoFocus={false}
        focusLock
      >
        <Form form={form} layout="vertical">
          <Form.Item label="规则名称" field="name" rules={[{ required: true, message: '请输入规则名称' }]}>
            <Input placeholder="例如：主站可用性切换" />
          </Form.Item>
          <Form.Item
            label="域名"
            field="domain_id"
            rules={[{ required: true, message: '请选择域名' }]}
          >
            <Select
              disabled={!!editing}
              onChange={(val) => {
                form.setFieldValue('record_id', undefined)
                fetchRecords(val as number)
              }}
            >
              {domains.map((d) => (
                <Select.Option key={d.id} value={d.id}>{d.domain}</Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item label="记录" field="record_id" rules={[{ required: true, message: '请选择记录' }]}>
            <Select disabled={!!editing}>
              {records.map((r) => (
                <Select.Option key={r.id} value={r.id}>
                  {r.name} ({r.type}) — {r.value}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item label="检测类型" field="check_type">
            <Select>
              <Select.Option value="ping">Ping</Select.Option>
              <Select.Option value="tcp">TCP</Select.Option>
              <Select.Option value="http">HTTP</Select.Option>
              <Select.Option value="https">HTTPS</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item label="检测目标" field="check_target" rules={[{ required: true, message: '请输入检测目标' }]}>
            <Input placeholder="例如：1.2.3.4:443 或 example.com" />
          </Form.Item>
          <Space size="large">
            <Form.Item label="检测间隔 (秒)" field="check_interval">
              <InputNumber min={5} max={86400} />
            </Form.Item>
            <Form.Item label="超时 (秒)" field="check_timeout">
              <InputNumber min={1} max={60} />
            </Form.Item>
            <Form.Item label="重试次数" field="retry_count">
              <InputNumber min={0} max={100} />
            </Form.Item>
          </Space>
          <Form.Item label="切换操作" field="action_type">
            <Select>
              <Select.Option value="modify">修改记录值</Select.Option>
              <Select.Option value="pause">暂停（指向备用值）</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item label="备用值" field="backup_value" rules={[{ required: true, message: '请输入备用值' }]}>
            <Input placeholder="故障时切换到的备用记录值" />
          </Form.Item>
          <Form.Item label="通知渠道" field="notify_channels">
            <Select mode="multiple" placeholder="选择通知渠道（可多选）">
              {channels.map((ch) => (
                <Select.Option key={ch.id} value={ch.id}>
                  {ch.name}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item label="启用" field="enabled" triggerPropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
