import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
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
  Radio,
} from '@arco-design/web-react'
import {
  IconDelete,
  IconRefresh,
  IconEye,
  IconApps,
  IconCopy,
  IconEdit,
  IconClose,
  IconPlus,
  IconSelectAll,
  IconInfoCircle,
  IconFolderAdd,
  IconFolderDelete,
  IconExport,
} from '@arco-design/web-react/icon'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
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

// Extract the actual value from a node label.
// For targetNode, label is "TYPE → VALUE" — we extract VALUE.
// For ipNode, label is the IP address directly.
function extractNodeValue(node: Node | undefined): string {
  if (!node) return ''
  const label = (node.data as any)?.label || ''
  if (node.type === 'targetNode') {
    const arrowIdx = label.indexOf(' → ')
    return arrowIdx >= 0 ? label.slice(arrowIdx + 3).trim() : label
  }
  return label
}

// Detect the best record type for a value.
function detectRecordType(value: string): string {
  if (/^([0-9]{1,3}\.){3}[0-9]{1,3}$/.test(value)) return 'A'
  if (/^([0-9a-fA-F:]+)$/.test(value) && value.includes(':')) return 'AAAA'
  return 'CNAME'
}

// Extract the record type from a targetNode label (e.g., "CNAME → ..." → "CNAME").
function extractTargetType(node: Node | undefined): string {
  if (!node || node.type !== 'targetNode') return 'CNAME'
  const label = (node.data as any)?.label || ''
  const arrowIdx = label.indexOf(' → ')
  if (arrowIdx >= 0) {
    const t = label.slice(0, arrowIdx).trim()
    if (RECORD_TYPES.includes(t)) return t
  }
  return 'CNAME'
}

const GROUP_COLORS = [
  '#6366f1', '#8b5cf6', '#3b82f6', '#06b6d4',
  '#10b981', '#f59e0b', '#ef4444', '#ec4899',
]

const edgeColors: Record<string, string> = {
  A: '#3b82f6',
  AAAA: '#8b5cf6',
  CNAME: '#f59e0b',
  MX: '#ef4444',
  TXT: '#6b7280',
  NS: '#10b981',
  SRV: '#ec4899',
  CAA: '#06b6d4',
  PTR: '#84cc16',
}

const edgeStyle = (type: string) => ({
  stroke: edgeColors[type] || 'var(--color-primary-light-2)',
  strokeWidth: 2,
})

const edgeLabelStyle = { fontSize: 10, fontWeight: 700, fill: 'var(--color-text-1)' }
const edgeLabelBgStyle = {
  fill: 'var(--color-bg-2)',
  fillOpacity: 0.95,
  stroke: 'var(--color-border-2)',
  strokeWidth: 1,
}
const edgeLabelBgPadding: [number, number] = [6, 2]

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

interface ContextMenuState {
  x: number
  y: number
  node?: Node
  edge?: Edge
}

// ─── Context Menu Items ────────────────────────────────────────────

interface MenuItem {
  key: string
  label: string
  icon?: React.ReactNode
  danger?: boolean
  divider?: false
}

interface MenuDivider {
  divider: true
}

type MenuEntry = MenuItem | MenuDivider

function getNodeMenuItems(node: Node, hasParent: boolean): MenuEntry[] {
  const items: MenuEntry[] = []

  if (node.type === 'domainNode') {
    items.push({ key: 'edit', label: '编辑域名', icon: <IconEdit /> })
    items.push({ key: 'copy', label: '复制节点', icon: <IconCopy /> })
    items.push({ key: 'add-to-group', label: '添加到分组', icon: <IconFolderAdd /> })
    if (hasParent) {
      items.push({ key: 'remove-from-group', label: '移出分组', icon: <IconExport /> })
    }
    items.push({ divider: true })
    items.push({ key: 'delete', label: '删除节点', icon: <IconDelete />, danger: true })
  } else if (node.type === 'ipNode') {
    items.push({ key: 'copy', label: '复制节点', icon: <IconCopy /> })
    items.push({ key: 'detail', label: '查看详情', icon: <IconInfoCircle /> })
    items.push({ key: 'add-to-group', label: '添加到分组', icon: <IconFolderAdd /> })
    if (hasParent) {
      items.push({ key: 'remove-from-group', label: '移出分组', icon: <IconExport /> })
    }
    items.push({ divider: true })
    items.push({ key: 'delete', label: '删除节点', icon: <IconDelete />, danger: true })
  } else {
    // targetNode
    items.push({ key: 'copy', label: '复制节点', icon: <IconCopy /> })
    items.push({ key: 'add-to-group', label: '添加到分组', icon: <IconFolderAdd /> })
    if (hasParent) {
      items.push({ key: 'remove-from-group', label: '移出分组', icon: <IconExport /> })
    }
    items.push({ divider: true })
    items.push({ key: 'delete', label: '删除节点', icon: <IconDelete />, danger: true })
  }

  return items
}

function getGroupNodeMenuItems(node: Node): MenuEntry[] {
  const collapsed = (node.data as any).collapsed as boolean
  return [
    { key: collapsed ? 'expand' : 'collapse', label: collapsed ? '展开分组' : '折叠分组', icon: collapsed ? <IconEye /> : <IconClose /> },
    { key: 'rename-group', label: '重命名分组', icon: <IconEdit /> },
    { divider: true },
    { key: 'ungroup', label: '取消分组', icon: <IconFolderDelete />, danger: true },
    { key: 'delete-group', label: '删除分组及内容', icon: <IconDelete />, danger: true },
  ]
}

function getEdgeMenuItems(_edge: Edge): MenuEntry[] {
  return [
    { key: 'add-record', label: '新增解析', icon: <IconPlus /> },
    { key: 'edit', label: '编辑记录', icon: <IconEdit /> },
    { divider: true },
    { key: 'delete', label: '删除连线', icon: <IconClose />, danger: true },
  ]
}

function getPaneMenuItems(): MenuEntry[] {
  return [
    { key: 'create-group', label: '创建分组', icon: <IconFolderAdd /> },
    { key: 'auto-generate', label: '自动生成已有记录', icon: <IconSelectAll /> },
    { key: 'add-domain', label: '添加域名节点', icon: <IconPlus /> },
    { divider: true },
    { key: 'clear', label: '清空画布', icon: <IconDelete />, danger: true },
  ]
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

  // Context menu
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null)

  // Edit domain node modal
  const [editModalVisible, setEditModalVisible] = useState(false)
  const [editNode, setEditNode] = useState<Node | null>(null)
  const [editForm] = Form.useForm()

  // IP detail modal
  const [detailModalVisible, setDetailModalVisible] = useState(false)
  const [detailIP, setDetailIP] = useState<IPAddress | null>(null)

  // Group modals
  const [createGroupModalVisible, setCreateGroupModalVisible] = useState(false)
  const [createGroupPos, setCreateGroupPos] = useState({ x: 0, y: 0 })
  const [createGroupForm] = Form.useForm()

  const [renameGroupModalVisible, setRenameGroupModalVisible] = useState(false)
  const [renameGroupNode, setRenameGroupNode] = useState<Node | null>(null)
  const [renameGroupForm] = Form.useForm()

  const [addToGroupModalVisible, setAddToGroupModalVisible] = useState(false)
  const [addToGroupNode, setAddToGroupNode] = useState<Node | null>(null)

  // Collapsed groups tracking
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  const reactFlowWrapper = useRef<HTMLDivElement>(null)
  const ctxMenuRef = useRef<HTMLDivElement>(null)

  // ─── Derive group nodes list ──────────────────────────────────────

  const groupNodes = useMemo(
    () => nodes.filter((n) => n.type === 'groupNode'),
    [nodes],
  )

  // ─── Apply collapsed state to child nodes ─────────────────────────

  const visibleNodes = useMemo(() => {
    return nodes.map((n) => {
      if (n.parentId && collapsedGroups.has(n.parentId)) {
        return { ...n, hidden: true }
      }
      return { ...n, hidden: false }
    })
  }, [nodes, collapsedGroups])

  // ─── Update child count on group nodes ────────────────────────────

  useEffect(() => {
    const counts = new Map<string, number>()
    nodes.forEach((n) => {
      if (n.parentId) {
        counts.set(n.parentId, (counts.get(n.parentId) || 0) + 1)
      }
    })
    let changed = false
    const updated = nodes.map((n) => {
      if (n.type === 'groupNode') {
        const count = counts.get(n.id) || 0
        if ((n.data as any).childCount !== count) {
          changed = true
          return { ...n, data: { ...n.data, childCount: count } }
        }
      }
      return n
    })
    if (changed) setNodes(updated)
  }, [nodes, setNodes])

  // ─── Close context menu on outside click / Escape ─────────────────

  useEffect(() => {
    const close = () => setCtxMenu(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    const onClick = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as HTMLElement)) {
        close()
      }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [])

  // ─── Fetch data ───────────────────────────────────────────────────

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

  // ─── Drag-and-drop from sidebar ──────────────────────────────────

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

  // ─── Edge connection ──────────────────────────────────────────────

  const pendingEdge = useRef<{ source: string; target: string } | null>(null)

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return
      const sourceNode = nodes.find((n) => n.id === connection.source)
      const targetNode = nodes.find((n) => n.id === connection.target)

      if (sourceNode?.type === 'domainNode' && (targetNode?.type === 'ipNode' || targetNode?.type === 'targetNode')) {
        // Create the edge first, then immediately open the record config modal
        const rawValue = extractNodeValue(targetNode)
        const recordType = targetNode?.type === 'targetNode'
          ? extractTargetType(targetNode)
          : detectRecordType(rawValue)
        const edgeId = `edge-${connection.source}-${connection.target}-${Date.now()}`
        setEdges((eds: Edge[]) =>
          addEdge(
            {
              ...connection,
              id: edgeId,
              type: 'smoothstep',
              animated: true,
              label: recordType,
              labelStyle: edgeLabelStyle,
              labelBgStyle: edgeLabelBgStyle,
              labelBgPadding: edgeLabelBgPadding as [number, number],
              labelBgBorderRadius: 4,
              markerEnd: { type: MarkerType.ArrowClosed, color: edgeColors[recordType] || edgeColors.A },
              style: edgeStyle(recordType),
            },
            eds,
          ),
        )
        // Store the edge ID and open the config modal
        pendingEdge.current = { source: connection.source, target: connection.target }
        setTimeout(() => {
          const newEdge: Edge = {
            id: edgeId,
            source: connection.source!,
            target: connection.target!,
            type: 'smoothstep',
            animated: true,
            label: recordType,
            data: {},
          }
          setSelectedEdge(newEdge)
          form.resetFields()
          form.setFieldsValue({ type: recordType, name: '@', ttl: 300 })
          setRecordModalVisible(true)
        }, 50)
      } else {
        Message.warning('只能从域名节点连接到 IP 节点')
      }
    },
    [nodes, setEdges, form],
  )

  // ─── Edge click → open record config modal ────────────────────────

  const onEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      setSelectedEdge(edge)
      const tNode = nodes.find((n) => n.id === edge.target)
      const rawValue = extractNodeValue(tNode)
      const detectedType = tNode?.type === 'targetNode'
        ? extractTargetType(tNode)
        : detectRecordType(rawValue)
      form.resetFields()
      form.setFieldsValue({ type: detectedType, name: '@', ttl: 300 })
      setRecordModalVisible(true)
    },
    [form, nodes],
  )

  // ─── Right-click context menu handlers ────────────────────────────

  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault()
      setCtxMenu({ x: event.clientX, y: event.clientY, node })
    },
    [],
  )

  const onEdgeContextMenu = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      event.preventDefault()
      setCtxMenu({ x: event.clientX, y: event.clientY, edge })
    },
    [],
  )

  const onPaneContextMenu = useCallback(
    (event: React.MouseEvent | MouseEvent) => {
      event.preventDefault()
      setCtxMenu({ x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY })
    },
    [],
  )

  // ─── Group helpers ────────────────────────────────────────────────

  const getGroupPosition = useCallback(
    (groupId: string) => {
      const g = nodes.find((n) => n.id === groupId)
      return g ? g.position : { x: 0, y: 0 }
    },
    [nodes],
  )

  // ─── Context menu actions ─────────────────────────────────────────

  const handleCtxMenuAction = useCallback(
    (key: string) => {
      setCtxMenu(null)

      if (!ctxMenu) return

      const { node, edge } = ctxMenu

      // ── Group node actions ──
      if (node && node.type === 'groupNode') {
        switch (key) {
          case 'collapse':
          case 'expand': {
            setCollapsedGroups((prev) => {
              const next = new Set(prev)
              if (next.has(node.id)) next.delete(node.id)
              else next.add(node.id)
              return next
            })
            break
          }
          case 'rename-group': {
            setRenameGroupNode(node)
            renameGroupForm.setFieldsValue({
              name: (node.data as any).label || '',
              color: (node.data as any).color || GROUP_COLORS[0],
            })
            setRenameGroupModalVisible(true)
            break
          }
          case 'ungroup': {
            // Remove parentId from all children
            setNodes((nds: Node[]) =>
              nds.map((n) => {
                if (n.parentId === node.id) {
                  const gp = getGroupPosition(node.id)
                  return { ...n, parentId: undefined, position: { x: n.position.x + gp.x, y: n.position.y + gp.y } }
                }
                return n
              }),
            )
            Message.success('已取消分组')
            break
          }
          case 'delete-group': {
            setNodes((nds: Node[]) => nds.filter((n) => n.id !== node.id && n.parentId !== node.id))
            setEdges((eds: Edge[]) =>
              eds.filter((e) => {
                const childIds = new Set(
                  nodes.filter((n) => n.parentId === node.id).map((n) => n.id),
                )
                return !childIds.has(e.source) && !childIds.has(e.target)
              }),
            )
            setCollapsedGroups((prev) => {
              const next = new Set(prev)
              next.delete(node.id)
              return next
            })
            Message.success('分组已删除')
            break
          }
        }
        return
      }

      // ── Regular node actions ──
      if (node) {
        switch (key) {
          case 'delete': {
            setNodes((nds: Node[]) => nds.filter((n) => n.id !== node.id))
            setEdges((eds: Edge[]) => eds.filter((e) => e.source !== node.id && e.target !== node.id))
            Message.success('节点已删除')
            break
          }
          case 'copy': {
            const offset = 40
            const newNode: Node = {
              ...node,
              id: `${node.type}-copy-${Date.now()}`,
              position: { x: node.position.x + offset, y: node.position.y + offset },
              selected: false,
            }
            setNodes((nds: Node[]) => nds.concat(newNode))
            Message.success('节点已复制')
            break
          }
          case 'edit': {
            setEditNode(node)
            editForm.setFieldsValue({
              label: (node.data as any).label || '',
              platform: (node.data as any).platform || '',
            })
            setEditModalVisible(true)
            break
          }
          case 'detail': {
            const ipLabel = (node.data as any).label || ''
            const found = ips.find((ip) => ip.ip === ipLabel)
            if (found) {
              setDetailIP(found)
              setDetailModalVisible(true)
            } else {
              Message.info('未找到该 IP 的详细信息')
            }
            break
          }
          case 'add-to-group': {
            if (groupNodes.length === 0) {
              Message.info('暂无分组，请先在画布右键创建分组')
              return
            }
            setAddToGroupNode(node)
            setAddToGroupModalVisible(true)
            break
          }
          case 'remove-from-group': {
            if (node.parentId) {
              const gp = getGroupPosition(node.parentId)
              setNodes((nds: Node[]) =>
                nds.map((n) =>
                  n.id === node.id
                    ? { ...n, parentId: undefined, position: { x: n.position.x + gp.x, y: n.position.y + gp.y } }
                    : n,
                ),
              )
              Message.success('已移出分组')
            }
            break
          }
        }
        return
      }

      // ── Edge actions ──
      if (edge) {
        switch (key) {
          case 'add-record': {
            setSelectedEdge(edge)
            const tNode = nodes.find((n) => n.id === edge.target)
            const rawVal = extractNodeValue(tNode)
            const detType = tNode?.type === 'targetNode'
              ? extractTargetType(tNode)
              : detectRecordType(rawVal)
            form.resetFields()
            form.setFieldsValue({ type: detType, name: '@', ttl: 300 })
            setRecordModalVisible(true)
            break
          }
          case 'delete': {
            setEdges((eds: Edge[]) => eds.filter((e) => e.id !== edge.id))
            Message.success('连线已删除')
            break
          }
          case 'edit': {
            setSelectedEdge(edge)
            form.resetFields()
            const data = edge.data as any
            form.setFieldsValue({
              type: data?.recordType || 'A',
              name: data?.recordName || '@',
              ttl: data?.ttl || 300,
            })
            setRecordModalVisible(true)
            break
          }
        }
        return
      }

      // ── Pane actions ──
      switch (key) {
        case 'create-group': {
          createGroupForm.resetFields()
          createGroupForm.setFieldsValue({ name: '新分组', color: GROUP_COLORS[0] })
          setCreateGroupPos({ x: ctxMenu.x, y: ctxMenu.y })
          setCreateGroupModalVisible(true)
          break
        }
        case 'auto-generate':
          handleAutoGenerate()
          break
        case 'clear':
          handleClearCanvas()
          break
        case 'add-domain': {
          if (domains.length === 0) {
            Message.info('暂无域名，请先在域名管理中添加')
            return
          }
          const d = domains[0]
          const newNode: Node = {
            id: `domainNode-${d.id}-${Date.now()}`,
            type: 'domainNode',
            position: { x: ctxMenu.x - 300, y: ctxMenu.y - 80 },
            data: {
              label: d.domain,
              platform: d.platform?.type || '',
              domainId: d.id,
            },
          }
          setNodes((nds: Node[]) => nds.concat(newNode))
          Message.success(`已添加域名节点: ${d.domain}`)
          break
        }
      }
    },
    [ctxMenu, setNodes, setEdges, editForm, form, ips, domains, groupNodes, getGroupPosition, renameGroupForm, createGroupForm],
  )

  // ─── Create group ─────────────────────────────────────────────────

  const handleCreateGroup = () => {
    const values = createGroupForm.getFieldsValue()
    const id = `group-${Date.now()}`
    const newNode: Node = {
      id,
      type: 'groupNode',
      position: createGroupPos,
      data: { label: values.name || '新分组', color: values.color || GROUP_COLORS[0], childCount: 0, collapsed: false },
      style: { width: 360, height: 240, zIndex: -1 },
    }
    setNodes((nds: Node[]) => nds.concat(newNode))
    setCreateGroupModalVisible(false)
    Message.success(`分组 "${values.name}" 已创建`)
  }

  // ─── Rename group ─────────────────────────────────────────────────

  const handleRenameGroup = () => {
    if (!renameGroupNode) return
    const values = renameGroupForm.getFieldsValue()
    setNodes((nds: Node[]) =>
      nds.map((n) =>
        n.id === renameGroupNode.id
          ? { ...n, data: { ...n.data, label: values.name, color: values.color } }
          : n,
      ),
    )
    setRenameGroupModalVisible(false)
    Message.success('分组已更新')
  }

  // ─── Add to group ─────────────────────────────────────────────────

  const handleAddToGroup = (groupId: string) => {
    if (!addToGroupNode) return
    const gp = getGroupPosition(groupId)

    setNodes((nds: Node[]) =>
      nds.map((n) =>
        n.id === addToGroupNode.id
          ? {
              ...n,
              parentId: groupId,
              position: {
                x: n.position.x - gp.x,
                y: n.position.y - gp.y,
              },
              extent: 'parent' as const,
            }
          : n,
      ),
    )
    setAddToGroupModalVisible(false)
    setAddToGroupNode(null)
    Message.success('节点已添加到分组')
  }

  // ─── Edit domain node ─────────────────────────────────────────────

  const handleEditNodeSave = () => {
    if (!editNode) return
    const values = editForm.getFieldsValue()
    setNodes((nds: Node[]) =>
      nds.map((n) =>
        n.id === editNode.id
          ? { ...n, data: { ...n.data, label: values.label, platform: values.platform } }
          : n,
      ),
    )
    setEditModalVisible(false)
    Message.success('节点已更新')
  }

  // ─── Save DNS record ──────────────────────────────────────────────

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

      const rawValue = extractNodeValue(targetNode)
      const recordValue = rawValue || values.value || ''
      await api.post(`/domains/${domainId}/records`, {
        name: values.name,
        type: values.type,
        value: recordValue,
        ttl: values.ttl,
        proxied: values.proxied || false,
      })

      // Update the edge label to show the actual record type
      setEdges((eds: Edge[]) =>
        eds.map((e) =>
          e.id === selectedEdge.id
            ? {
                ...e,
                label: values.type,
                labelStyle: edgeLabelStyle,
                labelBgStyle: edgeLabelBgStyle,
                labelBgPadding: edgeLabelBgPadding as [number, number],
                labelBgBorderRadius: 4,
                markerEnd: { type: MarkerType.ArrowClosed, color: edgeColors[values.type] || edgeColors.A },
                style: edgeStyle(values.type),
                data: { recordType: values.type, recordName: values.name, ttl: values.ttl },
              }
            : e,
        ),
      )

      Message.success('DNS 记录创建成功')
      setRecordModalVisible(false)
    } catch (e: any) {
      if (e?.response?.data?.error) {
        Message.error(e.response.data.error)
      }
    }
  }

  // ─── Auto-generate from existing records ──────────────────────────

  /**
   * Smart layout algorithm:
   * 1. Build a domain→IPs mapping from edges
   * 2. Place domains in a left column, spaced vertically
   * 3. For each domain, fan out its IPs in a column to the right
   * 4. Shared IPs (used by multiple domains) go to a shared column
   * 5. Non-IP targets go to a separate column on the far right
   */
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

      setNodes([])
      setEdges([])
      setCollapsedGroups(new Set())

      // Separate node types
      const domainNodes = autoNodes.filter((n) => n.type === 'domain')
      const ipNodes = autoNodes.filter((n) => n.type === 'ip')
      const targetNodes = autoNodes.filter((n) => n.type === 'target')

      // Build domain→IPs mapping from edges
      const domainIPs = new Map<string, string[]>()
      const ipDomains = new Map<string, string[]>()
      autoEdges.forEach((e) => {
        if (ipNodes.some((n) => n.id === e.target)) {
          if (!domainIPs.has(e.source)) domainIPs.set(e.source, [])
          const list = domainIPs.get(e.source)!
          if (!list.includes(e.target)) list.push(e.target)
          if (!ipDomains.has(e.target)) ipDomains.set(e.target, [])
          const dlist = ipDomains.get(e.target)!
          if (!dlist.includes(e.source)) dlist.push(e.source)
        }
      })

      // Identify shared IPs (used by multiple domains)
      const sharedIPs = new Set<string>()
      ipDomains.forEach((domains, ipId) => {
        if (domains.length > 1) sharedIPs.add(ipId)
      })

      const newNodes: Node[] = []

      // Layout constants
      const DOMAIN_X = 60
      const IP_X = 380
      const SHARED_X = 700
      const TARGET_X = 1020
      const VERTICAL_GAP = 120
      const IP_VERTICAL_GAP = 90

      // Place domain nodes
      domainNodes.forEach((n, i) => {
        newNodes.push({
          id: n.id,
          type: 'domainNode',
          position: { x: DOMAIN_X, y: i * VERTICAL_GAP + 30 },
          data: {
            label: n.label,
            platform: n.platform || '',
            domainId: parseInt(n.id.replace('domain-', ''), 10),
          },
        })
      })

      // Place IP nodes — grouped by domain, avoiding duplicates
      const placedIPs = new Set<string>()
      const placedTargets = new Set<string>()

      domainNodes.forEach((d, domainIdx) => {
        const ips = domainIPs.get(d.id) || []
        const domainY = domainIdx * VERTICAL_GAP + 30
        const exclusiveIPs = ips.filter((ip) => !sharedIPs.has(ip) && !placedIPs.has(ip))
        const sharedForThis = ips.filter((ip) => sharedIPs.has(ip) && !placedIPs.has(ip))

        // Place exclusive IPs for this domain
        exclusiveIPs.forEach((ipId, ipIdx) => {
          const node = ipNodes.find((n) => n.id === ipId)
          if (!node) return
          const totalIPs = exclusiveIPs.length
          const startY = domainY - ((totalIPs - 1) * IP_VERTICAL_GAP) / 2
          newNodes.push({
            id: node.id,
            type: 'ipNode',
            position: { x: IP_X, y: startY + ipIdx * IP_VERTICAL_GAP },
            data: {
              label: node.label,
              country: node.country || '',
              city: node.city || '',
              isp: node.isp || '',
            },
          })
          placedIPs.add(ipId)
        })

        // Place shared IPs (first domain that references them)
        sharedForThis.forEach((ipId) => {
          const node = ipNodes.find((n) => n.id === ipId)
          if (!node) return
          const sharedIdx = Array.from(sharedIPs).indexOf(ipId)
          newNodes.push({
            id: node.id,
            type: 'ipNode',
            position: { x: SHARED_X, y: sharedIdx * IP_VERTICAL_GAP + 30 },
            data: {
              label: node.label,
              country: node.country || '',
              city: node.city || '',
              isp: node.isp || '',
            },
          })
          placedIPs.add(ipId)
        })
      })

      // Place any remaining IPs (not connected to any domain)
      ipNodes.forEach((n, i) => {
        if (!placedIPs.has(n.id)) {
          newNodes.push({
            id: n.id,
            type: 'ipNode',
            position: { x: IP_X, y: i * IP_VERTICAL_GAP + domainNodes.length * VERTICAL_GAP + 60 },
            data: {
              label: n.label,
              country: n.country || '',
              city: n.city || '',
              isp: n.isp || '',
            },
          })
          placedIPs.add(n.id)
        }
      })

      // Place target nodes (CNAME, MX, etc.)
      targetNodes.forEach((n, i) => {
        newNodes.push({
          id: n.id,
          type: 'targetNode',
          position: { x: TARGET_X, y: i * 90 + 30 },
          data: { label: n.label },
        })
        placedTargets.add(n.id)
      })

      const newEdges: Edge[] = autoEdges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'smoothstep',
        animated: true,
        label: e.type,
        labelStyle: edgeLabelStyle,
        labelBgStyle: edgeLabelBgStyle,
        labelBgPadding: edgeLabelBgPadding as [number, number],
        labelBgBorderRadius: 4,
        markerEnd: { type: MarkerType.ArrowClosed, color: edgeColors[e.type] || edgeColors.A },
        style: edgeStyle(e.type),
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
    setCollapsedGroups(new Set())
  }

  const handleIPsChange = (newIPs: IPAddress[]) => {
    setIPs(newIPs)
  }

  const onDragStart = (event: React.DragEvent, item: any) => {
    event.dataTransfer.setData('application/reactflow', JSON.stringify(item))
    event.dataTransfer.effectAllowed = 'move'
  }

  const targetNode = nodes.find((n) => n.id === selectedEdge?.target)
  const targetIP = extractNodeValue(targetNode)

  // ─── Context menu items ───────────────────────────────────────────

  const menuItems: MenuEntry[] = ctxMenu?.node
    ? ctxMenu.node.type === 'groupNode'
      ? getGroupNodeMenuItems(ctxMenu.node)
      : getNodeMenuItems(ctxMenu.node, !!ctxMenu.node.parentId)
    : ctxMenu?.edge
      ? getEdgeMenuItems(ctxMenu.edge)
      : ctxMenu
        ? getPaneMenuItems()
        : []

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
                右键画布/节点/连线查看更多操作
              </Text>
            </div>

            <div ref={reactFlowWrapper} className="visual-dns-canvas">
              <ReactFlow
                nodes={visibleNodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onEdgeClick={onEdgeClick}
                onNodeContextMenu={onNodeContextMenu}
                onEdgeContextMenu={onEdgeContextMenu}
                onPaneContextMenu={onPaneContextMenu}
                onDragOver={onDragOver}
                onDrop={onDrop}
                nodeTypes={nodeTypes}
                fitView
                snapToGrid
                snapGrid={[16, 16]}
                deleteKeyCode={['Backspace', 'Delete']}
                multiSelectionKeyCode="Shift"
              >
                <Background color="var(--color-border-2)" gap={20} />
                <Controls />
                <MiniMap
                  nodeColor={(node) => {
                    if (node.type === 'groupNode') return 'rgba(99, 102, 241, 0.3)'
                    if (node.type === 'domainNode') return 'var(--color-primary-light-3)'
                    if (node.type === 'ipNode') return 'var(--color-success-light-3)'
                    return 'var(--color-warning-light-3)'
                  }}
                  maskColor="rgba(0,0,0,0.08)"
                  style={{ background: 'var(--color-bg-2)' }}
                />
              </ReactFlow>
            </div>
          </Card>
        </div>
      </div>

      {/* ── Context Menu ──────────────────────────────────────────── */}

      {ctxMenu && (
        <div
          ref={ctxMenuRef}
          className="visual-dns-ctx-menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          {menuItems.map((entry, i) =>
            'divider' in entry && entry.divider ? (
              <div key={`div-${i}`} className="visual-dns-ctx-menu-divider" />
            ) : (
              <div
                key={(entry as MenuItem).key}
                className={`visual-dns-ctx-menu-item${(entry as MenuItem).danger ? ' visual-dns-ctx-menu-item-danger' : ''}`}
                onClick={() => handleCtxMenuAction((entry as MenuItem).key)}
              >
                {(entry as MenuItem).icon && (
                  <span className="visual-dns-ctx-menu-icon">{(entry as MenuItem).icon}</span>
                )}
                <span>{(entry as MenuItem).label}</span>
              </div>
            ),
          )}
        </div>
      )}

      {/* ── Create Group Modal ────────────────────────────────────── */}

      <Modal
        title="创建分组"
        visible={createGroupModalVisible}
        onOk={handleCreateGroup}
        onCancel={() => setCreateGroupModalVisible(false)}
        okText="创建"
        cancelText="取消"
      >
        <Form form={createGroupForm} layout="vertical">
          <Form.Item label="分组名称" field="name" rules={[{ required: true, message: '请输入分组名称' }]}>
            <Input placeholder="例如：核心业务、CDN节点" />
          </Form.Item>
          <Form.Item label="分组颜色" field="color">
            <Radio.Group>
              {GROUP_COLORS.map((c) => (
                <Radio key={c} value={c}>
                  <span style={{
                    display: 'inline-block',
                    width: 20,
                    height: 20,
                    borderRadius: 4,
                    background: c,
                    verticalAlign: 'middle',
                    border: '2px solid var(--color-border-2)',
                  }} />
                </Radio>
              ))}
            </Radio.Group>
          </Form.Item>
        </Form>
      </Modal>

      {/* ── Rename Group Modal ────────────────────────────────────── */}

      <Modal
        title="重命名分组"
        visible={renameGroupModalVisible}
        onOk={handleRenameGroup}
        onCancel={() => setRenameGroupModalVisible(false)}
        okText="保存"
        cancelText="取消"
      >
        <Form form={renameGroupForm} layout="vertical">
          <Form.Item label="分组名称" field="name" rules={[{ required: true, message: '请输入分组名称' }]}>
            <Input placeholder="分组名称" />
          </Form.Item>
          <Form.Item label="分组颜色" field="color">
            <Radio.Group>
              {GROUP_COLORS.map((c) => (
                <Radio key={c} value={c}>
                  <span style={{
                    display: 'inline-block',
                    width: 20,
                    height: 20,
                    borderRadius: 4,
                    background: c,
                    verticalAlign: 'middle',
                    border: '2px solid var(--color-border-2)',
                  }} />
                </Radio>
              ))}
            </Radio.Group>
          </Form.Item>
        </Form>
      </Modal>

      {/* ── Add to Group Modal ────────────────────────────────────── */}

      <Modal
        title="选择目标分组"
        visible={addToGroupModalVisible}
        onCancel={() => { setAddToGroupModalVisible(false); setAddToGroupNode(null) }}
        footer={null}
        style={{ width: 360 }}
      >
        {groupNodes.length === 0 ? (
          <Text type="secondary">暂无分组</Text>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {groupNodes.map((g) => (
              <div
                key={g.id}
                onClick={() => handleAddToGroup(g.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  border: '1px solid var(--color-border-2)',
                  background: 'var(--color-bg-2)',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-fill-2)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--color-bg-2)')}
              >
                <span style={{
                  display: 'inline-block',
                  width: 12,
                  height: 12,
                  borderRadius: 3,
                  background: (g.data as any).color || GROUP_COLORS[0],
                  flexShrink: 0,
                }} />
                <span style={{ flex: 1, fontWeight: 600, fontSize: 14 }}>
                  {(g.data as any).label || '未命名'}
                </span>
                <Tag size="small" style={{ fontSize: 11 }}>
                  {(g.data as any).childCount || 0} 个节点
                </Tag>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* ── IP Manager Modal ──────────────────────────────────────── */}

      <IPManager
        visible={ipManagerVisible}
        onClose={() => setIPManagerVisible(false)}
        onIPsChange={handleIPsChange}
      />

      {/* ── DNS Record Config Modal ───────────────────────────────── */}

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

      {/* ── Edit Domain Node Modal ────────────────────────────────── */}

      <Modal
        title="编辑域名节点"
        visible={editModalVisible}
        onOk={handleEditNodeSave}
        onCancel={() => setEditModalVisible(false)}
        okText="保存"
        cancelText="取消"
      >
        <Form form={editForm} layout="vertical">
          <Form.Item label="域名" field="label" rules={[{ required: true, message: '请输入域名' }]}>
            <Input placeholder="例如：example.com" />
          </Form.Item>
          <Form.Item label="平台" field="platform">
            <Select placeholder="可选" allowClear>
              <Select.Option value="cloudflare">Cloudflare</Select.Option>
              <Select.Option value="porkbun">Porkbun</Select.Option>
              <Select.Option value="letsencrypt">Let's Encrypt</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      {/* ── IP Detail Modal ───────────────────────────────────────── */}

      <Modal
        title="IP 详情"
        visible={detailModalVisible}
        onCancel={() => setDetailModalVisible(false)}
        footer={null}
        style={{ width: 420 }}
      >
        {detailIP && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <Text type="secondary">IP 地址</Text>
                <div style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 16 }}>{detailIP.ip}</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 24 }}>
              <div>
                <Text type="secondary">国家</Text>
                <div>{detailIP.country || '-'}</div>
              </div>
              <div>
                <Text type="secondary">地区</Text>
                <div>{detailIP.region || '-'}</div>
              </div>
              <div>
                <Text type="secondary">城市</Text>
                <div>{detailIP.city || '-'}</div>
              </div>
            </div>
            <div>
              <Text type="secondary">ISP</Text>
              <div>{detailIP.isp || '-'}</div>
            </div>
            <div>
              <Text type="secondary">组织</Text>
              <div>{detailIP.org || '-'}</div>
            </div>
            {detailIP.latitude !== 0 && (
              <div>
                <Text type="secondary">坐标</Text>
                <div>{detailIP.latitude.toFixed(4)}, {detailIP.longitude.toFixed(4)}</div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}