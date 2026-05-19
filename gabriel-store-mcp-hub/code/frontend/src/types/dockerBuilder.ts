export interface DockerBuildProgress {
  type: 'start' | 'progress' | 'done' | 'error'
  status?: string
  percent?: number
  image?: string
  error?: string
  digest?: string
}

export interface BuildLogEntry {
  timestamp: Date
  message: string
  type: 'info' | 'progress' | 'error' | 'success'
}

export interface DockerBuildPayload {
  dockerfile: string
  imageName: string
  tag?: string
  buildArgs?: Record<string, string>
  platform?: string
}
