import { useState, useEffect } from 'react'
import {
  Modal,
  Input,
  Button,
  Table,
  Space,
  Message,
  Typography,
} from '@arco-design/web-react'
import { IconSearch, IconDelete, IconRefresh, IconPlus } from '@arco-design/web-react/icon'
import api from '@/api'

const { Text } = Typography

interface IPAddress {
  id: number
  ip: string
  country: string
  city: string
  region: string
  isp: string
  org: string
  latitude: number
  longitude: number
}

interface GeoPreview {
  status: string
  country: string
  regionName: string
  city: string
  isp: string
  org: string
  lat: number
  lon: number
}

function countryEmoji(country: string): string {
  const map: Record<string, string> = {
    'United States': '🇺🇸', 'China': '🇨🇳', 'Japan': '🇯🇵', 'Germany': '🇩🇪',
    'United Kingdom': '🇬🇧', 'France': '🇫🇷', 'South Korea': '🇰🇷', 'Canada': '🇨🇦',
    'Australia': '🇦🇺', 'Singapore': '🇸🇬', 'Netherlands': '🇳🇱', 'Brazil': '🇧🇷',
    'India': '🇮🇳', 'Russia': '🇷🇺', 'Hong Kong': '🇭🇰', 'Taiwan': '🇹🇼',
  }
  return map[country] || ''
}

interface Props {
  visible: boolean
  onClose: () => void
  onIPsChange: (ips: IPAddress[]) => void
}

export default function IPManager({ visible, onClose, onIPsChange }: Props) {
  const [ips, setIPs] = useState<IPAddress[]>([])
  const [loading, setLoading] = useState(false)
  const [newIP, setNewIP] = useState('')
  const [geoPreview, setGeoPreview] = useState<GeoPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')

  const fetchIPs = async () => {
    setLoading(true)
    try {
      const res = await api.get('/ips')
      const data = res.data.data || []
      setIPs(data)
      onIPsChange(data)
    } catch {
      Message.error('加载 IP 列表失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (visible) fetchIPs()
  }, [visible])

  const handleLookup = async () => {
    const ip = newIP.trim()
    if (!ip) {
      Message.warning('请输入 IP 地址')
      return
    }
    setPreviewLoading(true)
    setPreviewError('')
    setGeoPreview(null)
    try {
      const res = await api.get(`/ip-geo/${ip}`)
      setGeoPreview(res.data.data)
    } catch (e: any) {
      setPreviewError(e?.response?.data?.error || '查询失败')
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleAdd = async () => {
    const ip = newIP.trim()
    if (!ip) {
      Message.warning('请输入 IP 地址')
      return
    }
    try {
      await api.post('/ips', { ip })
      Message.success('IP 地址已添加')
      setNewIP('')
      setGeoPreview(null)
      setPreviewError('')
      fetchIPs()
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '添加失败')
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/ips/${id}`)
      Message.success('已删除')
      fetchIPs()
    } catch {
      Message.error('删除失败')
    }
  }

  const handleRefresh = async (id: number) => {
    try {
      await api.post(`/ips/${id}/refresh`)
      Message.success('已刷新')
      fetchIPs()
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '刷新失败')
    }
  }

  const columns = [
    { title: 'IP', dataIndex: 'ip', width: 140 },
    {
      title: '位置',
      dataIndex: 'country',
      width: 180,
      render: (country: string, record: IPAddress) => (
        <Space size={4}>
          <span>{countryEmoji(country)}</span>
          <span>{country} {record.region} {record.city}</span>
        </Space>
      ),
    },
    { title: 'ISP', dataIndex: 'isp', ellipsis: true },
    {
      title: '操作',
      width: 120,
      render: (_: any, record: IPAddress) => (
        <Space>
          <Button type="text" icon={<IconRefresh />} onClick={() => handleRefresh(record.id)} size="small" />
          <Button type="text" status="danger" icon={<IconDelete />} onClick={() => handleDelete(record.id)} size="small" />
        </Space>
      ),
    },
  ]

  return (
    <Modal
      title="IP 地址管理"
      visible={visible}
      onCancel={onClose}
      footer={null}
      style={{ width: 700 }}
    >
      <div style={{ marginBottom: 16 }}>
        <Space>
          <Input
            placeholder="输入 IP 地址（如 8.8.8.8）"
            value={newIP}
            onChange={setNewIP}
            style={{ width: 240 }}
            onPressEnter={handleLookup}
          />
          <Button icon={<IconSearch />} onClick={handleLookup} loading={previewLoading}>
            查询
          </Button>
          <Button type="primary" icon={<IconPlus />} onClick={handleAdd} disabled={!geoPreview}>
            添加到列表
          </Button>
        </Space>
        {previewError && (
          <div style={{ marginTop: 8, color: 'var(--color-danger)' }}>{previewError}</div>
        )}
        {geoPreview && (
          <div style={{
            marginTop: 12,
            padding: 12,
            background: 'var(--color-fill-2)',
            borderRadius: 6,
            display: 'flex',
            gap: 16,
            flexWrap: 'wrap',
          }}>
            <div>
              <Text type="secondary">国家</Text>
              <div>{countryEmoji(geoPreview.country)} {geoPreview.country}</div>
            </div>
            <div>
              <Text type="secondary">地区</Text>
              <div>{geoPreview.regionName}</div>
            </div>
            <div>
              <Text type="secondary">城市</Text>
              <div>{geoPreview.city}</div>
            </div>
            <div>
              <Text type="secondary">ISP</Text>
              <div>{geoPreview.isp}</div>
            </div>
            <div>
              <Text type="secondary">坐标</Text>
              <div>{geoPreview.lat.toFixed(4)}, {geoPreview.lon.toFixed(4)}</div>
            </div>
          </div>
        )}
        <Text type="secondary" style={{ display: 'block', marginTop: 4, fontSize: 12 }}>
          使用 ip-api.com 免费 API，每分钟限制 45 次请求
        </Text>
      </div>

      <Table
        columns={columns}
        data={ips}
        rowKey="id"
        loading={loading}
        pagination={false}
        size="small"
        scroll={{ y: 300 }}
      />
    </Modal>
  )
}