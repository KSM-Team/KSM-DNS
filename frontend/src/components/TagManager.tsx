import { useState, useEffect, useCallback } from 'react'
import {
  Modal,
  Button,
  Space,
  Input,
  Select,
  Tag,
  Message,
  Popconfirm,
  Empty,
  Spin,
} from '@arco-design/web-react'
import { IconPlus, IconEdit, IconDelete, IconTags } from '@arco-design/web-react/icon'
import api from '@/api'

const PRESET_COLORS = [
  'red', 'orangered', 'orange', 'gold', 'lime', 'green',
  'cyan', 'blue', 'arcoblue', 'purple', 'pinkpurple', 'magenta', 'gray',
]

interface TagItem {
  id: number
  name: string
  color: string
}

interface TagManagerProps {
  visible: boolean
  onClose: () => void
}

export default function TagManager({ visible, onClose }: TagManagerProps) {
  const [tags, setTags] = useState<TagItem[]>([])
  const [loading, setLoading] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('arcoblue')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('arcoblue')

  const fetchTags = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get('/tags')
      setTags(res.data.data || [])
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (visible) fetchTags()
  }, [visible, fetchTags])

  const handleCreate = async () => {
    if (!newName.trim()) {
      Message.warning('请输入标签名称')
      return
    }
    try {
      await api.post('/tags', { name: newName.trim(), color: newColor })
      Message.success('标签已创建')
      setNewName('')
      setNewColor('arcoblue')
      setCreating(false)
      fetchTags()
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '创建失败')
    }
  }

  const handleUpdate = async (id: number) => {
    if (!editName.trim()) {
      Message.warning('请输入标签名称')
      return
    }
    try {
      await api.put(`/tags/${id}`, { name: editName.trim(), color: editColor })
      Message.success('标签已更新')
      setEditingId(null)
      fetchTags()
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '更新失败')
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/tags/${id}`)
      Message.success('标签已删除')
      fetchTags()
    } catch (e: any) {
      Message.error(e?.response?.data?.error || '删除失败')
    }
  }

  const startEdit = (tag: TagItem) => {
    setEditingId(tag.id)
    setEditName(tag.name)
    setEditColor(tag.color)
  }

  return (
    <Modal
      title={
        <Space>
          <IconTags />
          标签管理
        </Space>
      }
      visible={visible}
      onCancel={onClose}
      footer={null}
      style={{ maxWidth: 480 }}
    >
      {/* Create new tag */}
      {creating ? (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
          <Input
            placeholder="标签名称"
            value={newName}
            onChange={setNewName}
            style={{ flex: 1 }}
            onPressEnter={handleCreate}
          />
          <Select
            value={newColor}
            onChange={setNewColor}
            style={{ width: 120 }}
            triggerProps={{ autoAlignPopupWidth: false }}
          >
            {PRESET_COLORS.map((c) => (
              <Select.Option key={c} value={c}>
                <Tag color={c} style={{ cursor: 'pointer' }}>{c}</Tag>
              </Select.Option>
            ))}
          </Select>
          <Button type="primary" size="small" onClick={handleCreate}>确定</Button>
          <Button size="small" onClick={() => setCreating(false)}>取消</Button>
        </div>
      ) : (
        <Button
          type="dashed"
          icon={<IconPlus />}
          long
          style={{ marginBottom: 16 }}
          onClick={() => setCreating(true)}
        >
          新建标签
        </Button>
      )}

      {/* Tag list */}
      <Spin loading={loading}>
        {tags.length === 0 ? (
          <Empty description="暂无标签" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {tags.map((tag) => (
              <div
                key={tag.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  borderRadius: 6,
                  background: 'var(--color-fill-1)',
                }}
              >
                {editingId === tag.id ? (
                  <div style={{ display: 'flex', gap: 8, flex: 1, alignItems: 'center' }}>
                    <Input
                      value={editName}
                      onChange={setEditName}
                      style={{ flex: 1 }}
                      onPressEnter={() => handleUpdate(tag.id)}
                    />
                    <Select
                      value={editColor}
                      onChange={setEditColor}
                      style={{ width: 100 }}
                    >
                      {PRESET_COLORS.map((c) => (
                        <Select.Option key={c} value={c}>
                          <Tag color={c}>{c}</Tag>
                        </Select.Option>
                      ))}
                    </Select>
                    <Button type="primary" size="small" onClick={() => handleUpdate(tag.id)}>保存</Button>
                    <Button size="small" onClick={() => setEditingId(null)}>取消</Button>
                  </div>
                ) : (
                  <>
                    <Tag color={tag.color}>{tag.name}</Tag>
                    <Space>
                      <Button
                        type="text"
                        size="small"
                        icon={<IconEdit />}
                        onClick={() => startEdit(tag)}
                      />
                      <Popconfirm
                        title="确定删除此标签？所有域名的该标签将被移除"
                        onOk={() => handleDelete(tag.id)}
                      >
                        <Button
                          type="text"
                          size="small"
                          status="danger"
                          icon={<IconDelete />}
                        />
                      </Popconfirm>
                    </Space>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </Spin>
    </Modal>
  )
}