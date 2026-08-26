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
  Checkbox,
} from '@arco-design/web-react'
import {
  IconPlus,
  IconDelete,
  IconSafe,
  IconLock,
} from '@arco-design/web-react/icon'
import api from '@/api'

const { Title } = Typography

interface User {
  id: number
  username: string
  role: string
  created_at: string
}

interface Domain {
  id: number
  domain: string
}

interface Permission {
  id?: number
  domain_id: number
  permission: string
  domain_info?: Domain
}

export default function Users() {
  const [users, setUsers] = useState<User[]>([])
  const [domains, setDomains] = useState<Domain[]>([])
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  const [createVisible, setCreateVisible] = useState(false)
  const [createForm] = Form.useForm()
  const [creating, setCreating] = useState(false)

  const [resetVisible, setResetVisible] = useState(false)
  const [resetForm] = Form.useForm()
  const [resetUser, setResetUser] = useState<User | null>(null)
  const [resetting, setResetting] = useState(false)

  const [permVisible, setPermVisible] = useState(false)
  const [permUser, setPermUser] = useState<User | null>(null)
  const [permMap, setPermMap] = useState<Record<number, string>>({})
  const [savingPerm, setSavingPerm] = useState(false)

  useEffect(() => {
    fetchUsers()
    fetchDomains()
  }, [page, pageSize])

  const fetchUsers = async () => {
    setLoading(true)
    try {
      const res = await api.get('/users', { params: { page, page_size: pageSize } })
      setUsers(res.data.data || [])
      setTotal(res.data.total || 0)
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '加载用户失败')
    } finally {
      setLoading(false)
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

  const openCreate = () => {
    createForm.resetFields()
    setCreateVisible(true)
  }

  const handleCreate = async () => {
    try {
      const values = await createForm.validate()
      setCreating(true)
      await api.post('/users', values)
      Message.success('子用户创建成功')
      setCreateVisible(false)
      fetchUsers()
    } catch (e: any) {
      if (e?.response?.data?.error) {
        Message.error(e.response.data.error)
      }
    } finally {
      setCreating(false)
    }
  }

  const openReset = (user: User) => {
    setResetUser(user)
    resetForm.resetFields()
    setResetVisible(true)
  }

  const handleReset = async () => {
    try {
      const values = await resetForm.validate()
      setResetting(true)
      await api.put(`/users/${resetUser!.id}`, { password: values.password })
      Message.success('密码重置成功')
      setResetVisible(false)
    } catch (e: any) {
      if (e?.response?.data?.error) {
        Message.error(e.response.data.error)
      }
    } finally {
      setResetting(false)
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/users/${id}`)
      Message.success('已删除')
      fetchUsers()
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '删除失败')
    }
  }

  const openPermissions = async (user: User) => {
    setPermUser(user)
    setPermMap({})
    try {
      const res = await api.get(`/users/${user.id}`)
      const perms: Permission[] = res.data.data.permissions || []
      const map: Record<number, string> = {}
      for (const p of perms) {
        map[p.domain_id] = p.permission
      }
      setPermMap(map)
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '加载权限失败')
    }
    setPermVisible(true)
  }

  const handleSavePermissions = async () => {
    const permissions = Object.entries(permMap).map(([domainId, permission]) => ({
      domain_id: Number(domainId),
      permission,
    }))
    try {
      setSavingPerm(true)
      await api.put(`/users/${permUser!.id}/permissions`, { permissions })
      Message.success('权限保存成功')
      setPermVisible(false)
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '保存权限失败')
    } finally {
      setSavingPerm(false)
    }
  }

  const toggleDomainPermission = (domainId: number, checked: boolean) => {
    setPermMap((prev) => {
      const next = { ...prev }
      if (checked) {
        if (!next[domainId]) next[domainId] = 'read'
      } else {
        delete next[domainId]
      }
      return next
    })
  }

  const setDomainPermissionLevel = (domainId: number, level: string) => {
    setPermMap((prev) => ({ ...prev, [domainId]: level }))
  }

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60, className: 'col-hide-mobile' },
    { title: '用户名', dataIndex: 'username' },
    {
      title: '角色',
      dataIndex: 'role',
      width: 120,
      render: (role: string) => (
        <Tag color={role === 'admin' ? 'red' : 'blue'}>
          {role === 'admin' ? '管理员' : '子用户'}
        </Tag>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 180,
      className: 'col-hide-mobile',
      render: (t: string) => (t ? t.slice(0, 19).replace('T', ' ') : '-'),
    },
    {
      title: '操作',
      width: 280,
      render: (_: any, record: User) => (
        <Space>
          <Button type="text" icon={<IconSafe />} onClick={() => openPermissions(record)} size="small">
            <span className="mobile-btn-text">域名权限</span>
          </Button>
          {record.role !== 'admin' && (
            <>
              <Button type="text" icon={<IconLock />} onClick={() => openReset(record)} size="small">
                <span className="mobile-btn-text">重置密码</span>
              </Button>
              <Popconfirm title="确定删除此子用户？" onOk={() => handleDelete(record.id)}>
                <Button type="text" status="danger" icon={<IconDelete />} size="small">
                  <span className="mobile-btn-text">删除</span>
                </Button>
              </Popconfirm>
            </>
          )}
        </Space>
      ),
    },
  ]

  return (
    <div>
      <Title heading={4} style={{ marginBottom: 16 }}>子用户管理</Title>
      <Card>
        <div style={{ marginBottom: 16 }}>
          <Button type="primary" icon={<IconPlus />} onClick={openCreate}>
            <span className="mobile-btn-text">添加子用户</span>
          </Button>
        </div>
        <Table
          columns={columns}
          data={users}
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
      </Card>

      <Modal
        title="添加子用户"
        visible={createVisible}
        onOk={handleCreate}
        confirmLoading={creating}
        onCancel={() => setCreateVisible(false)}
        autoFocus={false}
        focusLock
      >
        <Form form={createForm} layout="vertical">
          <Form.Item label="用户名" field="username" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input placeholder="子用户登录名" />
          </Form.Item>
          <Form.Item
            label="密码"
            field="password"
            rules={[{ required: true, min: 6, message: '密码至少6位' }]}
          >
            <Input.Password placeholder="至少6位" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`重置密码 — ${resetUser?.username || ''}`}
        visible={resetVisible}
        onOk={handleReset}
        confirmLoading={resetting}
        onCancel={() => setResetVisible(false)}
        autoFocus={false}
        focusLock
      >
        <Form form={resetForm} layout="vertical">
          <Form.Item
            label="新密码"
            field="password"
            rules={[{ required: true, min: 6, message: '密码至少6位' }]}
          >
            <Input.Password placeholder="至少6位" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`域名权限 — ${permUser?.username || ''}`}
        visible={permVisible}
        onOk={handleSavePermissions}
        confirmLoading={savingPerm}
        onCancel={() => setPermVisible(false)}
        autoFocus={false}
        focusLock
        style={{ width: 620 }}
      >
        <div style={{ color: 'var(--color-text-3)', marginBottom: 12, fontSize: 12 }}>
          勾选域名即授予访问权限，并选择权限级别；未勾选的域名该子用户不可见。
        </div>
        <div style={{ maxHeight: 360, overflowY: 'auto' }}>
          {domains.length === 0 ? (
            <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--color-text-3)' }}>
              暂无域名，请先在「域名管理」中添加域名。
            </div>
          ) : (
            domains.map((d) => {
              const hasPerm = !!permMap[d.id]
              const level = permMap[d.id] || 'read'
              return (
                <div
                  key={d.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '8px 0',
                    borderBottom: '1px solid var(--color-border-2)',
                  }}
                >
                  <Checkbox
                    checked={hasPerm}
                    onChange={(checked) => toggleDomainPermission(d.id, checked)}
                  >
                    {d.domain}
                  </Checkbox>
                  <Select
                    size="small"
                    style={{ width: 110 }}
                    disabled={!hasPerm}
                    value={level}
                    onChange={(v) => setDomainPermissionLevel(d.id, v)}
                  >
                    <Select.Option value="read">只读</Select.Option>
                    <Select.Option value="write">读写</Select.Option>
                    <Select.Option value="manage">管理</Select.Option>
                  </Select>
                </div>
              )
            })
          )}
        </div>
      </Modal>
    </div>
  )
}
