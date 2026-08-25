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
  Typography,
} from '@arco-design/web-react'
import {
  IconPlus,
  IconEdit,
  IconDelete,
  IconRefresh,
  IconSync,
  IconSend,
  IconDownload,
} from '@arco-design/web-react/icon'
import api from '@/api'
import { providerLogo, providerLabel, providerColor } from '@/utils/provider'

const { Title } = Typography

interface Domain {
  id: number
  domain: string
}

interface Certificate {
  id: number
  domain_id: number
  domain_name: string
  provider: string
  expires_at: string
  issued_at: string
  status: string
  auto_renew: boolean
  domain_info?: Domain
}

interface DeployTarget {
  id: number
  certificate_id: number
  name: string
  host: string
  port: number
  username: string
  auth_type: string
  cert_path: string
  key_path: string
  reload_cmd: string
  status: string
  last_deploy_at: string
}

const statusMap: Record<string, { label: string; color: string }> = {
  pending: { label: '待签发', color: 'gray' },
  issued: { label: '已签发', color: 'green' },
  expired: { label: '已过期', color: 'red' },
  failed: { label: '失败', color: 'red' },
}

const deployStatusMap: Record<string, { label: string; color: string }> = {
  pending: { label: '待部署', color: 'gray' },
  deployed: { label: '已部署', color: 'green' },
  failed: { label: '失败', color: 'red' },
}

export default function SSL() {
  const [certificates, setCertificates] = useState<Certificate[]>([])
  const [domains, setDomains] = useState<Domain[]>([])
  const [loading, setLoading] = useState(false)
  const [certTotal, setCertTotal] = useState(0)
  const [certPage, setCertPage] = useState(1)
  const [certPageSize, setCertPageSize] = useState(20)
  const [modalVisible, setModalVisible] = useState(false)
  const [deployVisible, setDeployVisible] = useState(false)
  const [targetModalVisible, setTargetModalVisible] = useState(false)
  const [targetEditing, setTargetEditing] = useState<DeployTarget | null>(null)
  const [targets, setTargets] = useState<DeployTarget[]>([])
  const [targetTotal, setTargetTotal] = useState(0)
  const [targetPage, setTargetPage] = useState(1)
  const [targetPageSize, setTargetPageSize] = useState(20)
  const [currentCert, setCurrentCert] = useState<Certificate | null>(null)
  const [form] = Form.useForm()
  const [targetForm] = Form.useForm()

  useEffect(() => {
    fetchCertificates()
    fetchDomains()
  }, [certPage, certPageSize])

  const fetchCertificates = async () => {
    setLoading(true)
    try {
      const res = await api.get('/ssl/certificates', { params: { page: certPage, page_size: certPageSize } })
      setCertificates(res.data.data || [])
      setCertTotal(res.data.total || 0)
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '加载证书失败')
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

  const fetchTargets = async (certId: number) => {
    try {
      const res = await api.get(`/ssl/certificates/${certId}/targets`, { params: { page: targetPage, page_size: targetPageSize } })
      setTargets(res.data.data || [])
      setTargetTotal(res.data.total || 0)
    } catch (e: any) {
      setTargets([])
      Message.error(e?.response?.data?.error || '加载部署目标失败')
    }
  }

  const openCreate = () => {
    form.resetFields()
    form.setFieldsValue({ provider: 'letsencrypt', auto_renew: true })
    setModalVisible(true)
  }

  const handleCreate = async () => {
    try {
      const values = await form.validate()
      const res = await api.post('/ssl/certificates', values)
      if (res.data.message) {
        Message.warning(res.data.message)
      } else {
        Message.success('证书签发成功')
      }
      setModalVisible(false)
      fetchCertificates()
    } catch (e: any) {
      if (e?.response?.data?.error) {
        Message.error(e.response.data.error)
      }
    }
  }

  const handleIssue = async (id: number) => {
    try {
      await api.post(`/ssl/certificates/${id}/issue`)
      Message.success('证书已重新签发')
      fetchCertificates()
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '签发失败')
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/ssl/certificates/${id}`)
      Message.success('已删除')
      fetchCertificates()
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '删除失败')
    }
  }

  const openDeploy = (cert: Certificate) => {
    setCurrentCert(cert)
    setTargetPage(1)
    fetchTargets(cert.id)
    setDeployVisible(true)
  }

  const openTargetCreate = () => {
    setTargetEditing(null)
    targetForm.resetFields()
    targetForm.setFieldsValue({ port: 22, auth_type: 'password' })
    setTargetModalVisible(true)
  }

  const openTargetEdit = (target: DeployTarget) => {
    setTargetEditing(target)
    targetForm.setFieldsValue({
      name: target.name,
      host: target.host,
      port: target.port,
      username: target.username,
      auth_type: target.auth_type,
      cert_path: target.cert_path,
      key_path: target.key_path,
      reload_cmd: target.reload_cmd,
    })
    setTargetModalVisible(true)
  }

  const handleTargetSubmit = async () => {
    try {
      const values = await targetForm.validate()
      if (targetEditing) {
        await api.put(`/ssl/targets/${targetEditing.id}`, values)
        Message.success('部署目标更新成功')
      } else {
        await api.post(`/ssl/certificates/${currentCert!.id}/targets`, values)
        Message.success('部署目标创建成功')
      }
      setTargetModalVisible(false)
      fetchTargets(currentCert!.id)
    } catch (e: any) {
      if (e?.response?.data?.error) {
        Message.error(e.response.data.error)
      }
    }
  }

  const handleTargetDelete = async (id: number) => {
    try {
      await api.delete(`/ssl/targets/${id}`)
      Message.success('已删除')
      fetchTargets(currentCert!.id)
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '删除失败')
    }
  }

  const handleDeploy = async (id: number) => {
    try {
      await api.post(`/ssl/targets/${id}/deploy`)
      Message.success('部署成功')
      fetchTargets(currentCert!.id)
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '部署失败')
    }
  }

  const formatTime = (t?: string) => (t ? t.slice(0, 19).replace('T', ' ') : '-')

  const downloadFile = async (id: number, kind: 'cert' | 'key') => {
    try {
      const path = kind === 'cert' ? 'download' : 'download-key'
      const res = await api.get(`/ssl/certificates/${id}/${path}`, { responseType: 'blob' })
      const disposition = res.headers['content-disposition'] || ''
      let filename = kind === 'cert' ? 'certificate.crt' : 'private.key'
      const match = disposition.match(/filename="?([^";]+)"?/)
      if (match) filename = match[1]
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
      Message.success('已开始下载')
    } catch (e: any) {
      const data = e?.response?.data
      if (data instanceof Blob) {
        const text = await data.text()
        try {
          const parsed = JSON.parse(text)
          Message.error(parsed.error || '下载失败')
        } catch {
          Message.error('下载失败')
        }
      } else {
        Message.error(data?.error || '下载失败')
      }
    }
  }

  const columns = [
    {
      title: '域名',
      dataIndex: 'domain_name',
      render: (name: string, record: Certificate) => (
        <Space>
          <img src={providerLogo[record.provider] || providerLogo['letsencrypt']} alt={record.provider} width={20} height={20} />
          <span>{name}</span>
        </Space>
      ),
    },
    {
      title: 'DNS 域名',
      dataIndex: 'domain_info',
      render: (d: Domain) => d?.domain || '-',
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (s: string) => {
        const m = statusMap[s]
        return m ? <Tag color={m.color}>{m.label}</Tag> : s
      },
    },
    {
      title: '签发机构',
      dataIndex: 'provider',
      width: 160,
      render: (p: string) => (
        <Tag color={providerColor[p]}>{providerLabel[p] || p}</Tag>
      ),
    },
    {
      title: '签发时间',
      dataIndex: 'issued_at',
      width: 160,
      render: (t: string) => formatTime(t),
    },
    {
      title: '到期时间',
      dataIndex: 'expires_at',
      width: 160,
      render: (t: string) => formatTime(t),
    },
    {
      title: '自动续期',
      dataIndex: 'auto_renew',
      width: 90,
      render: (v: boolean) => <Tag color={v ? 'green' : 'gray'}>{v ? '是' : '否'}</Tag>,
    },
    {
      title: '操作',
      width: 360,
      render: (_: any, record: Certificate) => (
        <Space>
          <Button type="text" icon={<IconSend />} onClick={() => openDeploy(record)} size="small">
            部署
          </Button>
          <Button type="text" icon={<IconSync />} onClick={() => handleIssue(record.id)} size="small">
            签发
          </Button>
          <Button type="text" icon={<IconDownload />} onClick={() => downloadFile(record.id, 'cert')} size="small">
            证书
          </Button>
          <Button type="text" icon={<IconDownload />} onClick={() => downloadFile(record.id, 'key')} size="small">
            私钥
          </Button>
          <Popconfirm title="确定删除此证书？" onOk={() => handleDelete(record.id)}>
            <Button type="text" status="danger" icon={<IconDelete />} size="small">
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const targetColumns = [
    { title: '名称', dataIndex: 'name' },
    { title: '主机', dataIndex: 'host' },
    { title: '端口', dataIndex: 'port', width: 70 },
    { title: '用户', dataIndex: 'username', width: 100 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (s: string) => {
        const m = deployStatusMap[s]
        return m ? <Tag color={m.color}>{m.label}</Tag> : s
      },
    },
    {
      title: '最近部署',
      dataIndex: 'last_deploy_at',
      width: 160,
      render: (t: string) => formatTime(t),
    },
    {
      title: '操作',
      width: 220,
      render: (_: any, record: DeployTarget) => (
        <Space>
          <Button type="text" icon={<IconSend />} onClick={() => handleDeploy(record.id)} size="small">
            部署
          </Button>
          <Button type="text" icon={<IconEdit />} onClick={() => openTargetEdit(record)} size="small">
            编辑
          </Button>
          <Popconfirm title="确定删除此部署目标？" onOk={() => handleTargetDelete(record.id)}>
            <Button type="text" status="danger" icon={<IconDelete />} size="small">
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <Title heading={4} style={{ marginBottom: 16 }}>SSL 证书</Title>
      <Card>
        <div style={{ marginBottom: 16 }}>
          <Space>
            <Button type="primary" icon={<IconPlus />} onClick={openCreate}>
              申请证书
            </Button>
            <Button icon={<IconRefresh />} onClick={fetchCertificates}>
              刷新
            </Button>
          </Space>
        </div>
        <Table
          columns={columns}
          data={certificates}
          rowKey="id"
          pagination={{
            current: certPage,
            pageSize: certPageSize,
            total: certTotal,
            showTotal: true,
            onChange: (p, ps) => {
              setCertPage(p)
              setCertPageSize(ps)
            },
          }}
          loading={loading}
        />
      </Card>

      <Modal
        title="申请证书"
        visible={modalVisible}
        onOk={handleCreate}
        onCancel={() => setModalVisible(false)}
        autoFocus={false}
        focusLock
      >
        <Form form={form} layout="vertical">
          <Form.Item label="DNS 域名" field="domain_id" rules={[{ required: true, message: '请选择域名' }]}>
            <Select placeholder="选择用于 DNS-01 验证的域名">
              {domains.map((d) => (
                <Select.Option key={d.id} value={d.id}>{d.domain}</Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item label="证书域名" field="domain_name" rules={[{ required: true, message: '请输入证书域名' }]}>
            <Input placeholder="例如：example.com 或 www.example.com" />
          </Form.Item>
          <Form.Item label="签发机构" field="provider">
            <Select>
              <Select.Option value="letsencrypt">Let's Encrypt</Select.Option>
              <Select.Option value="zerossl">ZeroSSL</Select.Option>
              <Select.Option value="google">Google Trust Services</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item shouldUpdate noStyle>
            {(values: any) => {
              if (values.provider === 'zerossl' || values.provider === 'google') {
                return (
                  <>
                    <Form.Item label="EAB Key ID (KID)" field="eab_kid" rules={[{ required: true, message: '请输入 EAB Key ID' }]}>
                      <Input placeholder="例如：ZSL_xxxxxxxx" />
                    </Form.Item>
                    <Form.Item label="EAB HMAC Key" field="eab_hmac_key" rules={[{ required: true, message: '请输入 EAB HMAC Key' }]}>
                      <Input.Password placeholder="Base64 编码的 HMAC Key" />
                    </Form.Item>
                  </>
                )
              }
              return null
            }}
          </Form.Item>
          <Form.Item label="自动续期" field="auto_renew" triggerPropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`部署管理 — ${currentCert?.domain_name || ''}`}
        visible={deployVisible}
        onCancel={() => setDeployVisible(false)}
        footer={null}
        style={{ width: 900 }}
        autoFocus={false}
        focusLock
      >
        <div style={{ marginBottom: 16 }}>
          <Button type="primary" icon={<IconPlus />} onClick={openTargetCreate}>
            添加部署目标
          </Button>
        </div>
        <Table
          columns={targetColumns}
          data={targets}
          rowKey="id"
          pagination={{
            current: targetPage,
            pageSize: targetPageSize,
            total: targetTotal,
            showTotal: true,
            onChange: (p, ps) => {
              setTargetPage(p)
              setTargetPageSize(ps)
            },
          }}
        />
      </Modal>

      <Modal
        title={targetEditing ? '编辑部署目标' : '添加部署目标'}
        visible={targetModalVisible}
        onOk={handleTargetSubmit}
        onCancel={() => setTargetModalVisible(false)}
        autoFocus={false}
        focusLock
      >
        <Form form={targetForm} layout="vertical">
          <Form.Item label="名称" field="name" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="例如：生产 Nginx 服务器" />
          </Form.Item>
          <Space size="large">
            <Form.Item label="主机" field="host" rules={[{ required: true, message: '请输入主机地址' }]}>
              <Input placeholder="例如：1.2.3.4" />
            </Form.Item>
            <Form.Item label="端口" field="port">
              <InputNumber min={1} max={65535} />
            </Form.Item>
          </Space>
          <Form.Item label="用户名" field="username" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input placeholder="例如：root" />
          </Form.Item>
          <Form.Item label="认证方式" field="auth_type">
            <Select>
              <Select.Option value="password">密码</Select.Option>
              <Select.Option value="key">SSH 私钥</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item shouldUpdate noStyle>
            {(values: any) => {
              if (values.auth_type === 'key') {
                return (
                  <Form.Item label="SSH 私钥" field="private_key" rules={[{ required: true, message: '请输入 SSH 私钥' }]}>
                    <Input.TextArea placeholder="粘贴 SSH 私钥内容" rows={4} />
                  </Form.Item>
                )
              }
              return (
                <Form.Item label="密码" field="password">
                  <Input.Password placeholder="SSH 密码" />
                </Form.Item>
              )
            }}
          </Form.Item>
          <Form.Item label="证书路径" field="cert_path" rules={[{ required: true, message: '请输入证书路径' }]}>
            <Input placeholder="/etc/ssl/certs/example.crt" />
          </Form.Item>
          <Form.Item label="私钥路径" field="key_path" rules={[{ required: true, message: '请输入私钥路径' }]}>
            <Input placeholder="/etc/ssl/private/example.key" />
          </Form.Item>
          <Form.Item label="Reload 命令" field="reload_cmd">
            <Input placeholder="例如：systemctl reload nginx" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
