import type { JsonRecord } from './common';
import type { McpContainer, McpTransport } from './mcp';

export interface ManagedTool {
  id: string;
  name: string;
  description: string;
  inputSchema?: JsonRecord;
  source: {
    mcpId: string;
    mcpName: string;
  };
  disabled: boolean;
}

export interface McpNamespace {
  id: string;
  name: string;
  description?: string;
  transport: McpTransport;
  port: number;
  createdAt: string;
  updatedAt: string;
  enabledMcps: string[];
  disabledTools: string[];
  metadata?: {
    color?: string;
    tags?: string[];
  };
}

export interface BuilderState {
  namespaces: McpNamespace[];
  selectedNamespace: McpNamespace | null;
  managedTools: ManagedTool[];
  availableMcps: McpContainer[];
}

export interface NamespaceFormData {
  name: string;
  description?: string;
}

export interface BuilderStatistics {
  totalTools: number;
  enabledTools: number;
  disabledTools: number;
  enabledMcpCount: number;
  totalMcpCount: number;
}
