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
  Switch,
  Message,
  Popconfirm,
  Tag,
  Tabs,
  Typography,
  DatePicker,
} from '@arco-design/web-react'
import {
  IconPlus,
  IconEdit,
  IconDelete,
  IconPlayArrow,
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

interface Task {
  id: number
  name: string
  domain_id: number
  record_id: number
  task_type: string
  cron_expr: string
  execute_at: string
  action_type: string
  action_value: string
  notify_channels: string
  enabled: boolean
  last_run_at: string
  next_run_at: string
  domain_info?: Domain
  record_info?: DNSRecord
}

interface SchedulerLog {
  id: number
  task_id: number
  status: string
  message: string
  created_at: string
}

const actionTypeMap: Record<string, { label: string; color: string }> = {
  modify: { label: '修改记录', color: 'blue' },
  enable: { label: '启用记录', color: 'green' },
  pause: { label: '暂停记录', color: 'orange' },
  delete: { label: '删除记录', color: 'red' },
}

export default function Scheduler() {
  const [activeTab, setActiveTab] = useState('tasks')
  const [tasks, setTasks] = useState<Task[]>([])
  const [logs, setLogs] = useState<SchedulerLog[]>([])
  const [domains, setDomains] = useState<Domain[]>([])
  const [records, setRecords] = useState<DNSRecord[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(false)
  const [taskTotal, setTaskTotal] = useState(0)
  const [taskPage, setTaskPage] = useState(1)
  const [taskPageSize, setTaskPageSize] = useState(20)
  const [logTotal, setLogTotal] = useState(0)
  const [logPage, setLogPage] = useState(1)
  const [logPageSize, setLogPageSize] = useState(20)
  const [modalVisible, setModalVisible] = useState(false)
  const [editing, setEditing] = useState<Task | null>(null)
  const [form] = Form.useForm()

  useEffect(() => {
    fetchTasks()
    fetchLogs()
    fetchDomains()
    fetchChannels()
  }, [taskPage, taskPageSize])

  useEffect(() => {
    fetchLogs()
  }, [logPage, logPageSize])

  const fetchTasks = async () => {
    setLoading(true)
    try {
      const res = await api.get('/scheduler/tasks', { params: { page: taskPage, page_size: taskPageSize } })
      setTasks(res.data.data || [])
      setTaskTotal(res.data.total || 0)
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '加载定时任务失败')
    } finally {
      setLoading(false)
    }
  }

  const fetchLogs = async () => {
    try {
      const res = await api.get('/scheduler/logs', { params: { page: logPage, page_size: logPageSize } })
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
      task_type: 'cron',
      action_type: 'modify',
      enabled: true,
      notify_channels: [],
    })
    setModalVisible(true)
  }

  const openEdit = (task: Task) => {
    setEditing(task)
    let channelIds: number[] = []
    try {
      channelIds = JSON.parse(task.notify_channels || '[]')
    } catch {}
    form.setFieldsValue({
      name: task.name,
      domain_id: task.domain_id,
      record_id: task.record_id,
      task_type: task.task_type,
      cron_expr: task.cron_expr,
      execute_at: task.execute_at ? task.execute_at : undefined,
      action_type: task.action_type,
      action_value: task.action_value,
      enabled: task.enabled,
      notify_channels: channelIds,
    })
    fetchRecords(task.domain_id)
    setModalVisible(true)
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validate()
      if (editing) {
        await api.put(`/scheduler/tasks/${editing.id}`, values)
        Message.success('任务更新成功')
      } else {
        await api.post('/scheduler/tasks', values)
        Message.success('任务创建成功')
      }
      setModalVisible(false)
      fetchTasks()
    } catch (e: any) {
      if (e?.response?.data?.error) {
        Message.error(e.response.data.error)
      }
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/scheduler/tasks/${id}`)
      Message.success('已删除')
      fetchTasks()
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '删除失败')
    }
  }

  const handleRunNow = async (id: number) => {
    try {
      await api.post(`/scheduler/tasks/${id}/run`)
      Message.success('任务已执行')
      fetchTasks()
      fetchLogs()
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '执行失败')
    }
  }

  const taskColumns = [
    { title: '名称', dataIndex: 'name' },
    {
      title: '域名',
      dataIndex: 'domain_info',
      className: 'col-hide-mobile',
      render: (d: Domain) => d?.domain || '-',
    },
    {
      title: '记录',
      dataIndex: 'record_info',
      className: 'col-hide-mobile',
      render: (r: DNSRecord) => (r ? `${r.name} (${r.type})` : '-'),
    },
    {
      title: '类型',
      dataIndex: 'task_type',
      width: 80,
      render: (t: string) => <Tag color={t === 'cron' ? 'purple' : 'cyan'}>{t === 'cron' ? '周期' : '单次'}</Tag>,
    },
    {
      title: '调度',
      render: (_: any, task: Task) => (
        <span style={{ fontSize: 12 }}>
          {task.task_type === 'cron' ? task.cron_expr : (task.execute_at || '-')?.slice(0, 19).replace('T', ' ')}
        </span>
      ),
    },
    {
      title: '操作',
      dataIndex: 'action_type',
      width: 100,
      className: 'col-hide-mobile',
      render: (a: string) => {
        const m = actionTypeMap[a]
        return m ? <Tag color={m.color}>{m.label}</Tag> : a
      },
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      width: 70,
      className: 'col-hide-mobile',
      render: (v: boolean) => <Tag color={v ? 'green' : 'gray'}>{v ? '是' : '否'}</Tag>,
    },
    {
      title: '下次执行',
      dataIndex: 'next_run_at',
      width: 160,
      render: (t: string) => (t ? t.slice(0, 19).replace('T', ' ') : '-'),
    },
    {
      title: '操作',
      width: 220,
      render: (_: any, record: Task) => (
        <Space>
          <Button type="text" icon={<IconPlayArrow />} onClick={() => handleRunNow(record.id)} size="small">
            <span className="mobile-btn-text">立即执行</span>
          </Button>
          <Button type="text" icon={<IconEdit />} onClick={() => openEdit(record)} size="small">
            <span className="mobile-btn-text">编辑</span>
          </Button>
          <Popconfirm title="确定删除此任务？" onOk={() => handleDelete(record.id)}>
            <Button type="text" status="danger" icon={<IconDelete />} size="small">
              <span className="mobile-btn-text">删除</span>
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const logColumns = [
    {
      title: '状态',
      dataIndex: 'status',
      width: 80,
      render: (s: string) => <Tag color={s === 'success' ? 'green' : 'red'}>{s === 'success' ? '成功' : '失败'}</Tag>,
    },
    { title: '内容', dataIndex: 'message', ellipsis: true },
    { title: '时间', dataIndex: 'created_at', width: 180, render: (t: string) => t?.slice(0, 19).replace('T', ' ') },
  ]

  return (
    <div>
      <Title heading={4} style={{ marginBottom: 16 }}>定时切换</Title>
      <Tabs activeTab={activeTab} onChange={setActiveTab}>
        <TabPane key="tasks" title="定时任务">
          <Card>
            <div style={{ marginBottom: 16 }}>
              <Space>
                <Button type="primary" icon={<IconPlus />} onClick={openCreate}>
                  <span className="mobile-btn-text">添加任务</span>
                </Button>
                <Button icon={<IconRefresh />} onClick={fetchTasks}>
                  <span className="mobile-btn-text">刷新</span>
                </Button>
              </Space>
            </div>
            <div className="table-responsive">
              <Table
                columns={taskColumns}
                data={tasks}
                rowKey="id"
                pagination={{
                  current: taskPage,
                  pageSize: taskPageSize,
                  total: taskTotal,
                  showTotal: true,
                  onChange: (p, ps) => {
                    setTaskPage(p)
                    setTaskPageSize(ps)
                  },
                }}
                loading={loading}
              />
            </div>
          </Card>
        </TabPane>
        <TabPane key="logs" title="执行日志">
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
      </Tabs>

      <Modal
        title={editing ? '编辑任务' : '添加任务'}
        visible={modalVisible}
        onOk={handleSubmit}
        onCancel={() => setModalVisible(false)}
        autoFocus={false}
        focusLock
      >
        <Form form={form} layout="vertical">
          <Form.Item label="任务名称" field="name" rules={[{ required: true, message: '请输入任务名称' }]}>
            <Input placeholder="例如：每晚切换主备线路" />
          </Form.Item>
          <Form.Item label="域名" field="domain_id" rules={[{ required: true, message: '请选择域名' }]}>
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
          <Form.Item label="任务类型" field="task_type">
            <Select disabled={!!editing}>
              <Select.Option value="cron">周期任务（Cron）</Select.Option>
              <Select.Option value="once">单次任务</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item shouldUpdate noStyle>
            {(values: any) => {
              if (values.task_type === 'cron') {
                return (
                  <Form.Item label="Cron 表达式" field="cron_expr" rules={[{ required: true, message: '请输入 Cron 表达式' }]}>
                    <Input placeholder="例如：0 2 * * * (每天凌晨2点)" />
                  </Form.Item>
                )
              }
              return (
                <Form.Item label="执行时间" field="execute_at" rules={[{ required: true, message: '请选择执行时间' }]}>
                  <DatePicker showTime format="YYYY-MM-DDTHH:mm:ss" style={{ width: '100%' }} />
                </Form.Item>
              )
            }}
          </Form.Item>
          <Form.Item label="操作类型" field="action_type">
            <Select>
              <Select.Option value="modify">修改记录值</Select.Option>
              <Select.Option value="enable">启用（恢复）</Select.Option>
              <Select.Option value="pause">暂停</Select.Option>
              <Select.Option value="delete">删除记录</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item shouldUpdate noStyle>
            {(values: any) => {
              if (values.action_type !== 'delete') {
                return (
                  <Form.Item label="目标值" field="action_value" rules={[{ required: true, message: '请输入目标记录值' }]}>
                    <Input placeholder="切换后的记录值" />
                  </Form.Item>
                )
              }
              return null
            }}
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
