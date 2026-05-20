import type Docker from 'dockerode'

export interface PullImageBody {
  image: string
  platform?: string
}

export interface PullImageQuery {
  image?: string
  platform?: string
}

export interface DockerImageSummary {
  id: string
  shortId: string
  tags: string[]
  created: number
  size: number
  isDangling: boolean
  inUse: boolean
  containersUsing: number
  platform?: string
}

export interface ImageRoutesDeps {
  docker: Docker
  pullImage: (image: string, platform?: string) => Promise<void>
  loadImagePlatforms: () => Record<string, string>
  recordImagePlatform: (imageRef: string, platform?: string) => void
  dataDir: string
}

export interface DockerVolumeSummary {
  name: string
  driver: string
  mountpoint: string
  createdAt: string
  scope: string
  inUse: boolean
  containersUsing: number
}

export interface VolumeRoutesDeps {
  docker: Docker
}
