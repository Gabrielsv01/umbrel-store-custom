import type Docker from 'dockerode'

export interface PullImageBody {
  image: string
}

export interface PullImageQuery {
  image?: string
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
}

export interface ImageRoutesDeps {
  docker: Docker
  pullImage: (image: string) => Promise<void>
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
