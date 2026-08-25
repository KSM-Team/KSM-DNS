import { useState, useEffect } from 'react'
import { Card, Form, Input, Button, Upload, Message, Space, Typography, Image, Alert, Popconfirm } from '@arco-design/web-react'
import { IconUpload, IconRefresh, IconCopy } from '@arco-design/web-react/icon'
import { useAuthStore } from '@/store/auth'
import api from '@/api'

const { Title, Text } = Typography

export default function Settings() {
  const [form] = Form.useForm()
  const [logoUrl, setLogoUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [vapidPublicKey, setVapidPublicKey] = useState('')
  const [generating, setGenerating] = useState(false)
  const { username } = useAuthStore()
  const [pwdLoading, setPwdLoading] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  useEffect(() => {
    fetchSettings()
  }, [])

  const fetchSettings = async () => {
    try {
      const res = await api.get('/settings')
      const data = res.data.data
      form.setFieldsValue({ site_name: data.site_name || '' })
      setLogoUrl(data.logo_url || '')
      setVapidPublicKey(data.vapid_public_key || '')
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '加载设置失败')
    }
  }

  const handleGenerateVapid = async () => {
    setGenerating(true)
    try {
      const res = await api.post('/settings/vapid/generate')
      setVapidPublicKey(res.data.public_key)
      Message.success('VAPID 密钥已重新生成')
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '生成 VAPID 密钥失败')
    } finally {
      setGenerating(false)
    }
  }

  const copyText = (text: string) => {
    navigator.clipboard?.writeText(text).then(
      () => Message.success('已复制'),
      () => Message.error('复制失败'),
    )
  }

  const handleSave = async () => {
    try {
      const values = await form.validate()
      setLoading(true)
      await api.post('/settings', { key: 'site_name', value: values.site_name })
      Message.success('保存成功')
    } catch {
      Message.error('保存失败')
    } finally {
      setLoading(false)
    }
  }

  const handleChangePassword = async () => {
    if (newPassword.length < 6) {
      Message.error('新密码至少6位')
      return
    }
    if (newPassword !== confirmPassword) {
      Message.error('两次输入的密码不一致')
      return
    }
    setPwdLoading(true)
    try {
      await api.post('/admin/change-user-password', {
        username,
        new_password: newPassword,
      })
      setNewPassword('')
      setConfirmPassword('')
      Message.success('管理员密码修改成功')
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '修改失败')
    } finally {
      setPwdLoading(false)
    }
  }

  const handleUploadLogo = async (file: File) => {
    setUploading(true)
    const formData = new FormData()
    formData.append('logo', file)
    try {
      const res = await api.post('/settings/logo', formData)
      setLogoUrl(res.data.url)
      Message.success('Logo上传成功')
    } catch {
      Message.error('Logo上传失败')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <Title heading={4}>系统设置</Title>

      <Card title="站点信息" style={{ marginBottom: 16 }}>
        <Form form={form} layout="vertical">
          <Form.Item label="站点名称" field="site_name" rules={[{ required: true, message: '请输入站点名称' }]}>
            <Input placeholder="KSM For DNS" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" loading={loading} onClick={handleSave}>
              保存设置
            </Button>
          </Form.Item>
        </Form>
      </Card>

      <Card title="站点Logo">
        <Space direction="vertical" size="medium" style={{ width: '100%' }}>
          {logoUrl && (
            <Image
              src={logoUrl}
              alt="Logo"
              width={120}
              height={120}
              style={{ objectFit: 'contain', border: '1px solid var(--color-border)', borderRadius: 4, padding: 8 }}
            />
          )}
          <Upload
            accept=".png,.jpg,.jpeg,.svg,.ico"
            autoUpload={false}
            showUploadList={false}
            onChange={(fileList) => {
              const file = fileList[fileList.length - 1]
              if (file?.originFile) {
                handleUploadLogo(file.originFile)
              }
            }}
          >
            <Button type="primary" icon={<IconUpload />} loading={uploading}>
              上传Logo
            </Button>
          </Upload>
          <div style={{ color: 'var(--color-text-3)', fontSize: 12 }}>
            支持 PNG、JPG、SVG、ICO 格式
          </div>
        </Space>
      </Card>

      <Card title="PWA 推送 (Web Push)" style={{ marginTop: 16 }}>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Alert
            type="info"
            content="VAPID 密钥用于标识推送服务，系统首次启动时已自动生成。重新生成后，已订阅的设备需重新订阅才能继续收到推送。"
          />
          <div>
            <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
              VAPID 公钥
            </Text>
            <Space style={{ width: '100%' }}>
              <Input.TextArea
                value={vapidPublicKey}
                readOnly
                autoSize={{ minRows: 2, maxRows: 4 }}
                style={{ flex: 1, fontFamily: 'monospace' }}
                placeholder="尚未生成 VAPID 密钥"
              />
              <Button icon={<IconCopy />} onClick={() => copyText(vapidPublicKey)} disabled={!vapidPublicKey}>
                复制
              </Button>
            </Space>
          </div>
          <Popconfirm title="确定重新生成 VAPID 密钥？现有订阅将失效。" onOk={handleGenerateVapid}>
            <Button type="primary" status="warning" icon={<IconRefresh />} loading={generating}>
              重新生成密钥
            </Button>
          </Popconfirm>
        </Space>
      </Card>

      <Card title="管理员密码" style={{ marginTop: 16 }}>
        <Space direction="vertical" size="medium" style={{ width: '100%' }}>
          <Alert
            type="warning"
            content="修改管理员密码不会影响其他用户的登录状态，建议定期更换密码确保安全。"
          />
          <Form layout="vertical">
            <Form.Item label="当前管理员">
              <Input value={username || ''} readOnly disabled />
            </Form.Item>
            <Form.Item label="新密码">
              <Input.Password
                value={newPassword}
                onChange={setNewPassword}
                placeholder="至少6位"
              />
            </Form.Item>
            <Form.Item label="确认密码">
              <Input.Password
                value={confirmPassword}
                onChange={setConfirmPassword}
                placeholder="再次输入新密码"
              />
            </Form.Item>
            <Form.Item>
              <Button type="primary" loading={pwdLoading} onClick={handleChangePassword}>
                修改密码
              </Button>
            </Form.Item>
          </Form>
        </Space>
      </Card>
    </div>
  )
}
