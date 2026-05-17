import type Docker from 'dockerode'
import type { BuildContainerOptionsInput, McpRuntimeConfig } from '../types/runtime.js'

function splitCommand(value?: string): string[] | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed.split(/\s+/) : undefined
}

function cleanStringArray(values?: string[]): string[] | undefined {
  const cleaned = (values ?? []).map((value) => value.trim()).filter(Boolean)
  return cleaned.length > 0 ? cleaned : undefined
}

function parseShmSize(value?: number | string): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value)
  }

  if (typeof value !== 'string') return undefined

  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return undefined
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed)
  }

  const match = trimmed.match(/^(\d+(?:\.\d+)?)([kmgt])b?$/i)
  if (!match) return undefined

  const amount = Number(match[1])
  const units: Record<string, number> = {
    k: 1024,
    m: 1024 ** 2,
    g: 1024 ** 3,
    t: 1024 ** 4,
  }

  return Math.floor(amount * units[match[2].toLowerCase()])
}

function parseDevices(devices?: string[]): Docker.DeviceMapping[] | undefined {
  const cleaned = cleanStringArray(devices)
  if (!cleaned) return undefined

  return cleaned.map((entry) => {
    const [pathOnHost = '', pathInContainer = '', permissions = 'rwm'] = entry.split(':')
    return {
      PathOnHost: pathOnHost.trim(),
      PathInContainer: pathInContainer.trim() || pathOnHost.trim(),
      CgroupPermissions: permissions.trim() || 'rwm',
    }
  })
}

export function normalizeRuntimeConfig(runtime?: McpRuntimeConfig): McpRuntimeConfig | undefined {
  if (!runtime) return undefined

  const normalized: McpRuntimeConfig = {}

  if (runtime.entrypoint?.trim()) normalized.entrypoint = runtime.entrypoint.trim()
  if (runtime.workingDir?.trim()) normalized.workingDir = runtime.workingDir.trim()
  if (runtime.networkMode?.trim()) normalized.networkMode = runtime.networkMode.trim()
  if (runtime.user?.trim()) normalized.user = runtime.user.trim()
  if (runtime.privileged === true) normalized.privileged = true

  const args = cleanStringArray(runtime.args)
  if (args) normalized.args = args

  const volumes = cleanStringArray(runtime.volumes)
  if (volumes) normalized.volumes = volumes

  const bindMounts = cleanStringArray(runtime.bindMounts)
  if (bindMounts) normalized.bindMounts = bindMounts

  const extraHosts = cleanStringArray(runtime.extraHosts)
  if (extraHosts) normalized.extraHosts = extraHosts

  const dns = cleanStringArray(runtime.dns)
  if (dns) normalized.dns = dns

  const devices = cleanStringArray(runtime.devices)
  if (devices) normalized.devices = devices

  const shmSize = parseShmSize(runtime.shmSize)
  if (shmSize) normalized.shmSize = shmSize

  return Object.keys(normalized).length > 0 ? normalized : undefined
}

export function buildContainerOptions(input: BuildContainerOptionsInput): Docker.ContainerCreateOptions {
  const envArr = Object.entries(input.env ?? {})
    .filter(([key]) => key.trim())
    .map(([key, value]) => `${key.trim()}=${value}`)

  const runtime = normalizeRuntimeConfig(input.runtime)
  let cmd: string[] | undefined
  if (runtime?.args && runtime.args.length > 0) {
    cmd = runtime.args
  } else if (Array.isArray(input.command)) {
    cmd = input.command
  } else {
    cmd = splitCommand(input.command)
  }
  const entrypoint = splitCommand(runtime?.entrypoint)
  const portStr = input.port ? String(input.port) : undefined
  const exposePort = input.transport !== 'stdio' && !!portStr
  const exposedPorts: Record<string, Record<string, never>> = exposePort
    ? { [`${portStr}/tcp`]: {} }
    : {}
  const portBindings: Docker.PortMap = exposePort
    ? { [`${portStr}/tcp`]: [{ HostPort: portStr }] }
    : {}
  const volumeMounts = Object.entries(input.volumes ?? {})
    .map(([containerPath, hostPath]) => `${hostPath}:${containerPath}:rw`)

  const binds = [...(runtime?.volumes ?? []), ...(runtime?.bindMounts ?? []), ...volumeMounts]

  return {
    name: input.name.trim(),
    Image: input.image.trim(),
    Cmd: cmd,
    Entrypoint: entrypoint,
    Env: envArr,
    WorkingDir: runtime?.workingDir,
    User: runtime?.user,
    OpenStdin: input.transport === 'stdio',
    AttachStdin: input.transport === 'stdio',
    AttachStdout: input.transport === 'stdio',
    AttachStderr: input.transport === 'stdio',
    Tty: false,
    Labels: { [input.mcpLabel]: 'true' },
    ExposedPorts: exposedPorts,
    HostConfig: {
      PortBindings: portBindings,
      RestartPolicy: { Name: input.transport === 'stdio' ? 'no' : 'unless-stopped' },
      Binds: binds.length > 0 ? binds : undefined,
      ExtraHosts: runtime?.extraHosts,
      Dns: runtime?.dns,
      NetworkMode: runtime?.networkMode,
      Privileged: runtime?.privileged,
      Devices: parseDevices(runtime?.devices),
      ShmSize: parseShmSize(runtime?.shmSize),
    },
  }
}
