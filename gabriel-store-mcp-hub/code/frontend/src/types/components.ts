import type { ReactNode } from 'react'
import type { HttpHealthResult, StdioHealthState } from './health'
import type { DeployPayload, EditMcpValues, McpContainer } from './mcp'
import type { ImageRecord, PullProgress, VolumeRecord } from './resources'
import type { CatalogEntry } from './catalog'

export type DeployFormProps = {
  onDeploy: (payload: DeployPayload) => Promise<void> | void
  onClose: () => void
  initialValues?: EditMcpValues
  title?: string
  submitLabel?: string
  submittingLabel?: string
}

export type FieldProps = {
  label: string
  children: ReactNode
}

export type McpAction = 'start' | 'stop' | 'remove'

export type MCPCardProps = {
  mcp: McpContainer
  onAction: (id: string, action: McpAction) => void
  actionLoading?: string | null
  onViewLogs: () => void
  onEdit: (mcp?: McpContainer) => void
  onOpenSession: (mcp?: McpContainer) => void
  onCheckHealth: (id: string) => void
  health?: StdioHealthState
  healthLoading: boolean
  httpHealth?: HttpHealthResult
  httpHealthLoading: boolean
}

export type CatalogModalProps = {
  onClose: () => void
  onSelect: (entry: CatalogEntry) => void
}

export type ImagesModalProps = {
  images: ImageRecord[]
  loading: boolean
  error: string | null
  onClose: () => void
  onRefresh: () => void | Promise<void>
  onRemove: (image: ImageRecord) => void | Promise<void>
  removingId: string | null
  onPull: (imageRef: string, onSuccess?: () => void) => void | Promise<void>
  pulling: boolean
  pullProgress: PullProgress | null
}

export type VolumesModalProps = {
  volumes: VolumeRecord[]
  loading: boolean
  error: string | null
  onClose: () => void
  onRefresh: () => void | Promise<void>
  onRemove: (volume: VolumeRecord) => void | Promise<void>
  removingName: string | null
}

export type ConsoleProps = {
  id: string
  name: string
  onClose: () => void
}
