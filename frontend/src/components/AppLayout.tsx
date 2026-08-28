import { useState, useEffect } from 'react'
import { Layout, Menu, Avatar, Dropdown, Message, Drawer, Button } from '@arco-design/web-react'
import {
  IconDashboard,
  IconCloud,
  IconApps,
  IconShareAlt,
  IconThunderbolt,
  IconClockCircle,
  IconSafe,
  IconNotification,
  IconSettings,
  IconUserGroup,
  IconMenu,
  IconSwap,
  IconBranch,
} from '@arco-design/web-react/icon'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/store/auth'
import api from '@/api'

const { Sider, Header, Content } = Layout
const MenuItem = Menu.Item
const SubMenu = Menu.SubMenu

interface MenuItemDef {
  key: string
  icon: React.ReactNode
  label: string
  adminOnly?: boolean
}

interface MenuGroup {
  key: string
  label: string
  icon: React.ReactNode
  children: MenuItemDef[]
}

const topLevelItems: MenuItemDef[] = [
  { key: '/dashboard', icon: <IconDashboard />, label: '仪表盘' },
]

const menuGroups: MenuGroup[] = [
  {
    key: 'domain-management', label: '域名管理', icon: <IconCloud />,
    children: [
      { key: '/domains', icon: <IconCloud />, label: '域名管理' },
      { key: '/platforms', icon: <IconApps />, label: 'DNS平台管理', adminOnly: true },
      { key: '/topology', icon: <IconShareAlt />, label: '拓扑图' },
      { key: '/migrate', icon: <IconSwap />, label: 'DNS迁移', adminOnly: true },
      { key: '/visual-dns', icon: <IconBranch />, label: '可视化解析', adminOnly: true },
    ],
  },
  {
    key: 'dns-switching', label: 'DNS切换', icon: <IconSwap />,
    children: [
      { key: '/failover', icon: <IconThunderbolt />, label: '容灾切换' },
      { key: '/scheduler', icon: <IconClockCircle />, label: '定时切换' },
    ],
  },
  {
    key: 'security', label: '安全', icon: <IconSafe />,
    children: [
      { key: '/ssl', icon: <IconSafe />, label: 'SSL证书' },
    ],
  },
  {
    key: 'system', label: '系统', icon: <IconSettings />,
    children: [
      { key: '/notifications', icon: <IconNotification />, label: '通知管理', adminOnly: true },
      { key: '/settings', icon: <IconSettings />, label: '系统设置', adminOnly: true },
      { key: '/users', icon: <IconUserGroup />, label: '子用户管理', adminOnly: true },
    ],
  },
]

// Flatten all items for selectedKey matching and document title
const allMenuItems = [...topLevelItems, ...menuGroups.flatMap((g) => g.children)]

export default function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { username, role, logout, setUser } = useAuthStore()
  const [collapsed, setCollapsed] = useState(false)
  const [siteName, setSiteName] = useState('KSM For DNS')
  const [drawerVisible, setDrawerVisible] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  // selectedKey: match the longest prefix among all leaf item keys
  const selectedKey = (() => {
    const path = location.pathname
    let best = '/dashboard'
    let bestLen = 0
    for (const item of allMenuItems) {
      if (path === item.key || path.startsWith(item.key + '/')) {
        if (item.key.length > bestLen) {
          best = item.key
          bestLen = item.key.length
        }
      }
    }
    return best
  })()
  const visibleGroups = menuGroups.map((group) => {
    const visibleChildren = group.children.filter(
      (item) => !item.adminOnly || role === 'admin'
    )
    return { ...group, children: visibleChildren }
  }).filter((group) => group.children.length > 0)

  // 响应式：根据视口宽度判断是否为手机端（与 Sider 的 lg breakpoint 对齐）。
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 992px)')
    const handler = (e: MediaQueryListEvent | MediaQueryList) => setIsMobile(e.matches)
    handler(mql)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])

  // 每次进入应用时从后端拉取真实角色，避免 localStorage 中的角色过期导致管理菜单缺失。
  useEffect(() => {
    api.get('/profile').then((res) => {
      const data = res.data
      if (data?.username && data?.role) {
        setUser(data.username, data.role)
      }
    }).catch(() => {})
  }, [setUser])

  useEffect(() => {
    api.get('/settings/public').then((res) => {
      if (res.data?.data?.site_name) {
        setSiteName(res.data.data.site_name)
      }
    }).catch(() => {})
  }, [])

  useEffect(() => {
    const current = allMenuItems.find((item) => item.key === selectedKey)
    document.title = current ? `KSM DNS - ${current.label}` : 'KSM DNS'
  }, [selectedKey])

  const handleLogout = () => {
    logout()
    Message.success('已退出登录')
    navigate('/login')
  }

  const navigateTo = (key: string) => {
    navigate(key)
    setDrawerVisible(false)
  }

  const menu = (
    <Menu
      selectedKeys={[selectedKey]}
      onClickMenuItem={navigateTo}
      style={{ width: '100%' }}
    >
      {topLevelItems.map((item) => (
        <MenuItem key={item.key}>
          {item.icon}
          {item.label}
        </MenuItem>
      ))}
      {visibleGroups.map((group) => (
        <SubMenu
          key={group.key}
          title={
            <span>
              {group.icon}
              {group.label}
            </span>
          }
        >
          {group.children.map((item) => (
            <MenuItem key={item.key}>
              {item.icon}
              {item.label}
            </MenuItem>
          ))}
        </SubMenu>
      ))}
    </Menu>
  )

  const brand = (
    <div style={{
      height: 48,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '16px 0',
      fontWeight: 700,
      fontSize: collapsed && !isMobile ? 14 : 16,
      color: 'var(--color-text-1)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
    }}>
      {collapsed && !isMobile ? 'KSM' : siteName}
    </div>
  )

  return (
    <Layout style={{ height: '100vh' }}>
      {!isMobile && (
        <Sider
          collapsed={collapsed}
          onCollapse={setCollapsed}
          collapsible
          breakpoint="lg"
          style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
        >
          {brand}
          {menu}
        </Sider>
      )}

      {isMobile && (
        <Drawer
          title={siteName}
          placement="left"
          width={260}
          visible={drawerVisible}
          onCancel={() => setDrawerVisible(false)}
          footer={null}
          closable={false}
        >
          {menu}
        </Drawer>
      )}

      <Layout>
        <Header style={{
          height: 48,
          display: 'flex',
          alignItems: 'center',
          justifyContent: isMobile ? 'space-between' : 'flex-end',
          padding: '0 12px',
          borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-bg-2)',
        }}>
          {isMobile && (
            <Button
              type="text"
              icon={<IconMenu />}
              onClick={() => setDrawerVisible(true)}
              aria-label="打开菜单"
            />
          )}
          <Dropdown
            trigger="click"
            droplist={
              <Menu onClickMenuItem={(key) => {
                if (key === 'logout') handleLogout()
                if (key === 'settings') navigate('/settings')
              }}>
                <MenuItem key="settings">系统设置</MenuItem>
                <MenuItem key="logout">退出登录</MenuItem>
              </Menu>
            }
          >
            <div style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: 8 }}>
              <Avatar size={28} style={{ backgroundColor: '#3370ff' }}>
                {username?.[0]?.toUpperCase()}
              </Avatar>
              {!isMobile && <span>{username}</span>}
            </div>
          </Dropdown>
        </Header>
        <Content
          style={{
            padding: isMobile ? 12 : 20,
            overflow: 'auto',
            background: 'var(--color-bg-1)',
          }}
        >
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
