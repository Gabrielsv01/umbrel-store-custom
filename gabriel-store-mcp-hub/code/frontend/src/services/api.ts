import type { JsonRecord } from '../types/common';
import type { HttpHealthResult, StdioHealthState } from '../types/health';
import type { DeployPayload, McpContainer } from '../types/mcp';
import type { ImageRecord, VolumeRecord } from '../types/resources';
import type { CatalogEntry } from '../types/catalog';
import type { JsonRpcPayload, JsonRpcResponse, McpTool } from '../types/inspector';

type RequestOptions = RequestInit | undefined;

async function toJsonOrEmpty(response: Response): Promise<unknown | null> {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function getErrorMessage(payload: unknown, fallbackMessage: string): string {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const errorValue = (payload as JsonRecord).error;
    if (typeof errorValue === 'string') return errorValue;
  }

  return fallbackMessage;
}

async function requestJson(
  url: string,
  options: RequestOptions,
  fallbackMessage: string
) {
  const response = await fetch(url, options);
  const payload = await toJsonOrEmpty(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(payload, fallbackMessage));
  }

  return payload;
}

export async function listMcps(): Promise<McpContainer[]> {
  const payload = await requestJson(
    '/api/mcps',
    undefined,
    'Failed to fetch MCPs'
  );
  return Array.isArray(payload) ? (payload as McpContainer[]) : [];
}

export async function deployMcp(formData: DeployPayload): Promise<unknown> {
  return requestJson(
    '/api/deploy',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData),
    },
    'Deploy failed'
  );
}

export async function updateMcp(
  id: string,
  formData: DeployPayload
): Promise<unknown> {
  return requestJson(
    `/api/mcps/${id}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData),
    },
    'Update failed'
  );
}

export async function runMcpAction(
  id: string,
  action: string
): Promise<unknown> {
  return requestJson(
    `/api/action/${id}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    },
    'Action failed'
  );
}

export async function getStdioHealth(id: string): Promise<StdioHealthState> {
  return requestJson(
    `/api/stdio/health/${id}?probe=network`,
    undefined,
    'Health check failed'
  ) as Promise<StdioHealthState>;
}

export async function listImages(): Promise<ImageRecord[]> {
  const payload = await requestJson(
    '/api/images',
    undefined,
    'Failed to fetch images'
  );
  return Array.isArray(payload) ? (payload as ImageRecord[]) : [];
}

export async function removeImage(shortId: string): Promise<unknown> {
  return requestJson(
    `/api/images/${shortId}`,
    { method: 'DELETE' },
    'Failed to remove image'
  );
}

export async function listVolumes(): Promise<VolumeRecord[]> {
  const payload = await requestJson(
    '/api/volumes',
    undefined,
    'Failed to fetch volumes'
  );
  return Array.isArray(payload) ? (payload as VolumeRecord[]) : [];
}

export async function removeVolume(name: string): Promise<unknown> {
  return requestJson(
    `/api/volumes/${encodeURIComponent(name)}`,
    { method: 'DELETE' },
    'Failed to remove volume'
  );
}

export async function getHttpHealth(id: string): Promise<HttpHealthResult> {
  return requestJson(
    `/api/health/http/${id}`,
    undefined,
    'Health check failed'
  ) as Promise<HttpHealthResult>;
}

export async function fetchCatalog(): Promise<CatalogEntry[]> {
  const payload = await requestJson(
    '/api/catalog',
    undefined,
    'Failed to fetch catalog'
  );
  return Array.isArray(payload) ? (payload as CatalogEntry[]) : [];
}

export async function callMcpInspect(
  id: string,
  payload: JsonRpcPayload
): Promise<JsonRpcResponse> {
  return requestJson(
    `/api/mcp/inspect/${id}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    'MCP inspect call failed'
  ) as Promise<JsonRpcResponse>;
}

interface GetToolsResponse {
  tools: McpTool[];
  disabledTools: string[];
}

export async function getMcpTools(id: string): Promise<GetToolsResponse> {
  return requestJson(
    `/api/mcps/${encodeURIComponent(id)}/tools`,
    undefined,
    'Failed to list tools'
  ) as Promise<GetToolsResponse>;
}

export async function updateDisabledTools(
  id: string,
  disabledTools: string[]
): Promise<unknown> {
  return requestJson(
    `/api/mcps/${encodeURIComponent(id)}/tools`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disabledTools }),
    },
    'Failed to update disabled tools'
  );
}
