import { useState, useEffect, useRef } from 'react'
import { Form, Input, Button, Message, Modal } from '@arco-design/web-react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/auth'
import api from '@/api'
import './login.css'

export default function Login() {
  const navigate = useNavigate()
  const { login, isLoggedIn, mustChangePassword, clearMustChangePassword } = useAuthStore()
  const [loading, setLoading] = useState(false)
  const [siteName, setSiteName] = useState('KSM For DNS')
  const [logoUrl, setLogoUrl] = useState('')
  const [showPwdModal, setShowPwdModal] = useState(false)
  const [pwdLoading, setPwdLoading] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const loginPasswordRef = useRef('')

  useEffect(() => {
    if (isLoggedIn && !mustChangePassword) {
      navigate('/dashboard', { replace: true })
    }
    if (isLoggedIn && mustChangePassword) {
      setShowPwdModal(true)
    }
  }, [isLoggedIn, mustChangePassword, navigate])

  useEffect(() => {
    api.get('/settings/public').then((res) => {
      if (res.data?.data?.site_name) setSiteName(res.data.data.site_name)
      if (res.data?.data?.logo_url) setLogoUrl(res.data.data.logo_url)
    }).catch(() => {})
  }, [])

  const handleSubmit = async (values: { username: string; password: string }) => {
    setLoading(true)
    try {
      const res = await api.post('/login', values)
      loginPasswordRef.current = values.password
      const mcp = res.data.must_change_password === true
      login(res.data.token, res.data.username, res.data.role, mcp)
      Message.success('登录成功')
      if (mcp) {
        setShowPwdModal(true)
      } else {
        navigate('/dashboard', { replace: true })
      }
    } catch (err: any) {
      Message.error(err.response?.data?.error || '登录失败')
    } finally {
      setLoading(false)
    }
  }

  const handleChangePassword = async () => {
    if (newPassword.length < 8) {
      Message.error('新密码至少8位，且需包含大小写字母和数字')
      return
    }
    if (newPassword !== confirmPassword) {
      Message.error('两次输入的密码不一致')
      return
    }
    setPwdLoading(true)
    try {
      await api.post('/change-password', {
        old_password: loginPasswordRef.current,
        new_password: newPassword,
      })
      clearMustChangePassword()
      setShowPwdModal(false)
      Message.success('密码修改成功')
      navigate('/dashboard', { replace: true })
    } catch (err: any) {
      Message.error(err.response?.data?.error || '修改密码失败')
    } finally {
      setPwdLoading(false)
    }
  }

  const handleSkip = async () => {
    try {
      await api.post('/skip-change-password')
    } catch {}
    clearMustChangePassword()
    setShowPwdModal(false)
    navigate('/dashboard', { replace: true })
  }

  return (
    <>
      <div className="login-page">
        <div className="login-card">
          {logoUrl && (
            <div className="login-logo">
              <img src={logoUrl} alt={siteName} />
            </div>
          )}
          <h1 className="login-title">{siteName}</h1>
          <p className="login-subtitle">智能 DNS 与 SSL 证书管理平台</p>

          <Form onSubmit={handleSubmit} autoComplete="off" layout="vertical">
            <Form.Item label="用户名" field="username" rules={[{ required: true, message: '请输入用户名' }]}>
              <Input placeholder="请输入用户名" size="large" />
            </Form.Item>
            <Form.Item label="密码" field="password" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password placeholder="请输入密码" size="large" />
            </Form.Item>
            <Button type="primary" htmlType="submit" long size="large" loading={loading} className="login-submit">
              登录
            </Button>
          </Form>

          <div className="login-footer">KSM For DNS · 安全高效</div>
        </div>
      </div>

      <Modal
        title="首次登录 - 请修改密码"
        visible={showPwdModal}
        closable={false}
        maskClosable={false}
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Button onClick={handleSkip}>暂不修改</Button>
            <Button type="primary" loading={pwdLoading} onClick={handleChangePassword}>
              确认修改
            </Button>
          </div>
        }
      >
        <div style={{ padding: '8px 0' }}>
          <p style={{ marginBottom: 16, color: 'var(--color-text-2)' }}>
            检测到您正在使用默认管理员密码，为了账户安全，建议立即修改密码。
          </p>
          <Form layout="vertical">
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
          </Form>
        </div>
      </Modal>
    </>
  )
}
