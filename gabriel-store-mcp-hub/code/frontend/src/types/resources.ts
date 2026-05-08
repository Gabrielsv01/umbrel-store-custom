export interface ImageRecord {
  id: string
  shortId: string
  tags: string[]
  size: number
  created: number
  inUse: boolean
  containersUsing?: number
  isDangling?: boolean
}

export interface VolumeRecord {
  name: string
  driver: string
  mountpoint?: string
  createdAt?: string
  inUse?: boolean
  containersUsing?: number
}

export interface PullProgress {
  image: string
  status: string
  id?: string | null
  current?: number
  total?: number
  percent?: number | null
}

export interface PullPayload {
  type?: string
  status?: string
  id?: string
  overallCurrent?: number
  overallTotal?: number
  overallPercent?: number
  error?: string
}
