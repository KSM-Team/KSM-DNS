import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Card,
  Button,
  Typography,
  Message,
  Modal,
  Form,
  Select,
  Input,
  InputNumber,
  Switch,
  Tag,
} from '@arco-design/web-react'
import {
  IconDelete,
  IconRefresh,
  IconEye,
  IconApps,
} from '@arco-design/web-react/icon'
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type Node,
  type Edge,
  MarkerType,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import api from '@/api'
import { providerLogo, providerShort, providerColor } from '@/utils/provider'
import { nodeTypes } from './nodes'
import IPManager from './IPManager'
import './styles.css'

const { Title, Text } = Typography

const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA', 'PTR']

interface Domain {
  id: number
  domain: string
  platform_id: number
  platform?: { id: number; name: string; type: string }
}

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

interface AutoNode {
  id: string
  type: string
  label: string
  platform?: string
  country?: string
  city?: string
  isp?: string
}

interface AutoEdge {
  id: string
  source: string
  target: string
  type: string
  name: string
  ttl: number
}

export default function VisualDNS() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [domains, setDomains] = useState<Domain[]>([])
  const [ips, setIPs] = useState<IPAddress[]>([])
  const [ipManagerVisible, setIPManagerVisible] = useState(false)
  const [recordModalVisible, setRecordModalVisible] = useState(false)
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null)
  const [loading, setLoading] = useState(false)
  const [form] = Form.useForm()
  const reactFlowWrapper = useRef<HTMLDivElement>(null)

  // Fetch domains and IPs
  const fetchData = useCallback(async () => {
    try {
      const [domainRes, ipRes] = await Promise.all([
        api.get('/domains', { params: { page: 1, page_size: 500 } }),
        api.get('/ips'),
      ])
      setDomains(domainRes.data.data || [])
      setIPs(ipRes.data.data || [])
    } catch {
      Message.error('加载数据失败')
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Drag-and-drop from sidebar
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      const raw = event.dataTransfer.getData('application/reactflow')
      if (!raw || !reactFlowWrapper.current) return

      const data = JSON.parse(raw)
      const rect = reactFlowWrapper.current.getBoundingClientRect()
      const position = {
        x: event.clientX - rect.left - 80,
        y: event.clientY - rect.top - 20,
      }

      const id = `${data.type}-${data.label}-${Date.now()}`
      const newNode: Node = {
        id,
        type: data.nodeType,
        position,
        data: {
          label: data.label,
          platform: data.platform || '',
          country: data.country || '',
          city: data.city || '',
          isp: data.isp || '',
          domainId: data.domainId || 0,
        },
      }
      setNodes((nds: Node[]) => nds.concat(newNode))
    },
    [setNodes],
  )

  // Edge connection validation
  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return
      const sourceNode = nodes.find((n) => n.id === connection.source)
      const targetNode = nodes.find((n) => n.id === connection.target)

      if (sourceNode?.type === 'domainNode' && (targetNode?.type === 'ipNode' || targetNode?.type === 'targetNode')) {
        setEdges((eds: Edge[]) =>
          addEdge(
            {
              ...connection,
              type: 'smoothstep',
              animated: true,
              markerEnd: { type: MarkerType.ArrowClosed },
              style: { stroke: 'var(--color-primary-light-2)', strokeWidth: 2 },
            },
            eds,
          ),
        )
      } else {
        Message.warning('只能从域名节点连接到 IP 节点')
      }
    },
    [nodes, setEdges],
  )

  // Edge click → open record config modal
  const onEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      setSelectedEdge(edge)
      form.resetFields()
      form.setFieldsValue({ type: 'A', name: '@', ttl: 300 })
      setRecordModalVisible(true)
    },
    [form],
  )

  // Save DNS record
  const handleSaveRecord = async () => {
    if (!selectedEdge) return
    try {
      const values = await form.validate()
      const sourceNode = nodes.find((n) => n.id === selectedEdge.source)
      const targetNode = nodes.find((n) => n.id === selectedEdge.target)
      const domainId = (sourceNode?.data as any)?.domainId

      if (!domainId) {
        Message.error('无法找到源域名 ID')
        return
      }

      const recordValue = (targetNode?.data as any)?.label || values.value || ''
      await api.post(`/domains/${domainId}/records`, {
        name: values.name,
        type: values.type,
        value: recordValue,
        ttl: values.ttl,
        proxied: values.proxied || false,
      })

      Message.success('DNS 记录创建成功')
      setRecordModalVisible(false)
    } catch (e: any) {
      if (e?.response?.data?.error) {
        Message.error(e.response.data.error)
      }
    }
  }

  // Auto-generate from existing records
  const handleAutoGenerate = async () => {
    setLoading(true)
    try {
      const res = await api.get('/visual-dns/records')
      const { nodes: autoNodes, edges: autoEdges } = res.data.data as {
        nodes: AutoNode[]
        edges: AutoEdge[]
      }

      if (!autoNodes.length) {
        Message.info('暂无已有的 DNS 记录')
        setLoading(false)
        return
      }

      // Clear existing
      setNodes([])
      setEdges([])

      // Position nodes in a grid layout
      const domainNodes = autoNodes.filter((n) => n.type === 'domain')
      const ipNodes = autoNodes.filter((n) => n.type === 'ip' || n.type === 'target')

      const newNodes: Node[] = []
      domainNodes.forEach((n, i) => {
        newNodes.push({
          id: n.id,
          type: 'domainNode',
          position: { x: 50, y: i * 100 + 20 },
          data: {
            label: n.label,
            platform: n.platform || '',
            domainId: parseInt(n.id.replace('domain-', ''), 10),
          },
        })
      })
      ipNodes.forEach((n, i) => {
        newNodes.push({
          id: n.id,
          type: n.type === 'ip' ? 'ipNode' : 'targetNode',
          position: { x: 400, y: i * 100 + 20 },
          data: {
            label: n.label,
            country: n.country || '',
            city: n.city || '',
            isp: n.isp || '',
          },
        })
      })

      const newEdges: Edge[] = autoEdges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'smoothstep',
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: 'var(--color-primary-light-2)', strokeWidth: 2 },
        data: { recordType: e.type, recordName: e.name, ttl: e.ttl },
      }))

      setNodes(newNodes)
      setEdges(newEdges)
      Message.success(`已生成 ${newNodes.length} 个节点和 ${newEdges.length} 条连线`)
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  const handleClearCanvas = () => {
    setNodes([])
    setEdges([])
  }

  const handleIPsChange = (newIPs: IPAddress[]) => {
    setIPs(newIPs)
  }

  // Drag start handler for sidebar items
  const onDragStart = (event: React.DragEvent, item: any) => {
    event.dataTransfer.setData('application/reactflow', JSON.stringify(item))
    event.dataTransfer.effectAllowed = 'move'
  }

  const targetNode = nodes.find((n) => n.id === selectedEdge?.target)
  const targetIP = (targetNode?.data as any)?.label || ''

  return (
    <div>
      <Title heading={4} style={{ marginBottom: 16 }}>可视化解析</Title>

      <div className="visual-dns-layout">
        {/* Sidebar */}
        <div className="visual-dns-sidebar">
          <Card
            title="域名列表"
            size="small"
            bodyStyle={{ padding: 8, maxHeight: 300, overflow: 'auto' }}
          >
            {domains.map((d) => (
              <div
                key={d.id}
                className="visual-dns-drag-item"
                draggable
                onDragStart={(e) =>
                  onDragStart(e, {
                    nodeType: 'domainNode',
                    type: 'domain',
                    label: d.domain,
                    platform: d.platform?.type || '',
                    domainId: d.id,
                  })
                }
              >
                <img
                  src={providerLogo[d.platform?.type || ''] || providerLogo.letsencrypt}
                  alt=""
                  width={16}
                  height={16}
                />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {d.domain}
                </span>
                {d.platform?.type && (
                  <Tag color={providerColor[d.platform.type]} size="small">
                    {providerShort[d.platform.type]}
                  </Tag>
                )}
              </div>
            ))}
            {!domains.length && (
              <Text type="secondary" style={{ fontSize: 12, padding: 8, display: 'block' }}>
                暂无域名
              </Text>
            )}
          </Card>

          <Card
            title="IP 地址列表"
            size="small"
            style={{ marginTop: 12 }}
            bodyStyle={{ padding: 8, maxHeight: 300, overflow: 'auto' }}
          >
            {ips.map((ip) => (
              <div
                key={ip.id}
                className="visual-dns-drag-item"
                draggable
                onDragStart={(e) =>
                  onDragStart(e, {
                    nodeType: 'ipNode',
                    type: 'ip',
                    label: ip.ip,
                    country: ip.country,
                    city: ip.city,
                    isp: ip.isp,
                  })
                }
              >
                <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{ip.ip}</span>
                <span style={{ fontSize: 11, color: 'var(--color-text-3)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {ip.country} {ip.city}
                </span>
              </div>
            ))}
            {!ips.length && (
              <Text type="secondary" style={{ fontSize: 12, padding: 8, display: 'block' }}>
                暂无 IP 地址，请先添加
              </Text>
            )}
          </Card>
        </div>

        {/* Canvas */}
        <div className="visual-dns-canvas-wrapper">
          <Card bodyStyle={{ padding: 0 }}>
            <div style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--color-border-2)' }}>
              <Button
                type="primary"
                icon={<IconEye />}
                onClick={handleAutoGenerate}
                loading={loading}
                size="small"
              >
                自动生成已有记录
              </Button>
              <Button
                icon={<IconApps />}
                onClick={() => setIPManagerVisible(true)}
                size="small"
              >
                管理 IP 地址
              </Button>
              <Button
                icon={<IconDelete />}
                onClick={handleClearCanvas}
                size="small"
                disabled={nodes.length === 0}
              >
                清空画布
              </Button>
              <Button icon={<IconRefresh />} onClick={fetchData} size="small">
                刷新
              </Button>
              <div style={{ flex: 1 }} />
              <Text type="secondary" style={{ fontSize: 12 }}>
                拖拽域名和 IP 到画布，连接它们来配置 DNS 解析
              </Text>
            </div>

            <div ref={reactFlowWrapper} className="visual-dns-canvas">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onEdgeClick={onEdgeClick}
                onDragOver={onDragOver}
                onDrop={onDrop}
                nodeTypes={nodeTypes}
                fitView
                snapToGrid
                snapGrid={[16, 16]}
                deleteKeyCode={['Backspace', 'Delete']}
              >
                <Background color="var(--color-border-2)" gap={20} />
                <Controls />
              </ReactFlow>
            </div>
          </Card>
        </div>
      </div>

      {/* IP Manager Modal */}
      <IPManager
        visible={ipManagerVisible}
        onClose={() => setIPManagerVisible(false)}
        onIPsChange={handleIPsChange}
      />

      {/* DNS Record Config Modal */}
      <Modal
        title="配置 DNS 解析记录"
        visible={recordModalVisible}
        onOk={handleSaveRecord}
        onCancel={() => setRecordModalVisible(false)}
        okText="创建记录"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Form.Item label="记录类型" field="type" rules={[{ required: true, message: '请选择记录类型' }]}>
            <Select>
              {RECORD_TYPES.map((t) => (
                <Select.Option key={t} value={t}>{t}</Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item label="名称" field="name" rules={[{ required: true, message: '请输入记录名称' }]}>
            <Input placeholder="例如：www 或 @" />
          </Form.Item>
          <Form.Item label="值">
            <Input value={targetIP} disabled placeholder="自动从目标 IP 节点获取" />
          </Form.Item>
          <Form.Item label="TTL (秒)" field="ttl">
            <InputNumber min={60} max={86400} />
          </Form.Item>
          <Form.Item label="代理 (Cloudflare)" field="proxied" triggerPropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}