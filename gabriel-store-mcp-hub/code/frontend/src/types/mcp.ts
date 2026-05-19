import type { JsonRecord } from './common';

export type McpTransport = 'http' | 'stdio' | 'streamable-http';

export interface McpRuntime {
  entrypoint?: string;
  args?: string[];
  workingDir?: string;
  volumes?: string[];
  bindMounts?: string[];
  extraHosts?: string[];
  dns?: string[];
  networkMode?: string;
  user?: string;
  privileged?: boolean;
  devices?: string[];
  shmSize?: string | number;
}

export interface McpMeta {
  name?: string;
  image?: string;
  transport?: McpTransport;
  command?: string;
  port?: number | string;
  env?: JsonRecord;
  secretKeys?: string[];
  runtime?: McpRuntime;
  disabledTools?: string[];
  isCustomNamespace?: boolean;
  namespaceId?: string;
  enabledMcps?: string[];
  isCustomToolsMcp?: boolean;
  customToolDefinition?: Record<string, unknown>;
  httpHeaders?: JsonRecord;
}

export interface McpContainer {
  id: string;
  name: string;
  image: string;
  status: string;
  ports?: number[];
  meta?: McpMeta;
}

export interface DeployPayload {
  name: string;
  image: string;
  transport: McpTransport;
  command?: string;
  port?: number;
  platform?: string;
  env: JsonRecord;
  secretKeys?: string[];
  runtime: McpRuntime;
  httpHeaders?: JsonRecord;
}

export interface EditMcpValues extends DeployPayload {
  id: string;
}
