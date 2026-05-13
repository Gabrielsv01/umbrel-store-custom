import type { McpRuntime, McpTransport } from './mcp';

export interface CatalogEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  image: string;
  transport: McpTransport;
  command?: string;
  runtime?: McpRuntime;
  port?: number;
  env?: Record<string, string>;
  secretKeys?: string[];
}
