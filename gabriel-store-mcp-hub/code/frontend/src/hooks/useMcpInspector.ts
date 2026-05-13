import { useState, useCallback, useEffect } from 'react'
import { callMcpInspect } from '../services/api'
import type {
  McpInspectorTab,
  McpTool,
  McpResource,
  McpPrompt,
  JsonRpcPayload,
  JsonRpcResponse,
  ToolsListResponse,
  ResourcesListResponse,
  PromptsListResponse,
} from '../types/inspector'

interface UseMcpInspectorState {
  selectedId: string | null
  activeTab: McpInspectorTab
  tools: McpTool[]
  resources: McpResource[]
  prompts: McpPrompt[]
  loading: boolean
  error: string | null
  callResult: JsonRpcResponse | null
  callLoading: boolean
  selectedTool: McpTool | null
  toolParams: Record<string, string>
}

export function useMcpInspector() {
  const [state, setState] = useState<UseMcpInspectorState>({
    selectedId: null,
    activeTab: 'tools',
    tools: [],
    resources: [],
    prompts: [],
    loading: false,
    error: null,
    callResult: null,
    callLoading: false,
    selectedTool: null,
    toolParams: {},
  })

  const setSelectedId = useCallback((id: string | null) => {
    setState((prev) => ({
      ...prev,
      selectedId: id,
      tools: [],
      resources: [],
      prompts: [],
      error: null,
      callResult: null,
      selectedTool: null,
      toolParams: {},
    }))
  }, [])

  const setActiveTab = useCallback((tab: McpInspectorTab) => {
    setState((prev) => ({
      ...prev,
      activeTab: tab,
      callResult: null,
    }))
  }, [])

  const setSelectedTool = useCallback((tool: McpTool | null) => {
    setState((prev) => ({
      ...prev,
      selectedTool: tool,
      toolParams: {},
      callResult: null,
    }))
  }, [])

  const setToolParam = useCallback((key: string, value: string) => {
    setState((prev) => ({
      ...prev,
      toolParams: {
        ...prev.toolParams,
        [key]: value,
      },
    }))
  }, [])

  const fetchTools = useCallback(async () => {
    if (!state.selectedId) return

    setState((prev) => ({ ...prev, loading: true, error: null }))
    try {
      const payload: JsonRpcPayload = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      }
      const response = await callMcpInspect(state.selectedId, payload)

      if (response.error) {
        setState((prev) => ({
          ...prev,
          loading: false,
          error: response.error.message,
          tools: [],
        }))
        return
      }

      const tools = ((response.result as ToolsListResponse)?.tools ?? []) as McpTool[]
      setState((prev) => ({
        ...prev,
        loading: false,
        tools,
      }))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch tools'
      setState((prev) => ({
        ...prev,
        loading: false,
        error: message,
        tools: [],
      }))
    }
  }, [state.selectedId])

  const fetchResources = useCallback(async () => {
    if (!state.selectedId) return

    setState((prev) => ({ ...prev, loading: true, error: null }))
    try {
      const payload: JsonRpcPayload = {
        jsonrpc: '2.0',
        id: 2,
        method: 'resources/list',
        params: {},
      }
      const response = await callMcpInspect(state.selectedId, payload)

      if (response.error) {
        setState((prev) => ({
          ...prev,
          loading: false,
          error: response.error.message,
          resources: [],
        }))
        return
      }

      const resources = ((response.result as ResourcesListResponse)?.resources ?? []) as McpResource[]
      setState((prev) => ({
        ...prev,
        loading: false,
        resources,
      }))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch resources'
      setState((prev) => ({
        ...prev,
        loading: false,
        error: message,
        resources: [],
      }))
    }
  }, [state.selectedId])

  const fetchPrompts = useCallback(async () => {
    if (!state.selectedId) return

    setState((prev) => ({ ...prev, loading: true, error: null }))
    try {
      const payload: JsonRpcPayload = {
        jsonrpc: '2.0',
        id: 3,
        method: 'prompts/list',
        params: {},
      }
      const response = await callMcpInspect(state.selectedId, payload)

      if (response.error) {
        setState((prev) => ({
          ...prev,
          loading: false,
          error: response.error.message,
          prompts: [],
        }))
        return
      }

      const prompts = ((response.result as PromptsListResponse)?.prompts ?? []) as McpPrompt[]
      setState((prev) => ({
        ...prev,
        loading: false,
        prompts,
      }))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch prompts'
      setState((prev) => ({
        ...prev,
        loading: false,
        error: message,
        prompts: [],
      }))
    }
  }, [state.selectedId])

  const callTool = useCallback(async () => {
    if (!state.selectedId || !state.selectedTool) return

    setState((prev) => ({ ...prev, callLoading: true, error: null }))
    try {
      // Convert string params to appropriate types based on inputSchema
      const arguments_: Record<string, unknown> = {}
      const schema = state.selectedTool.inputSchema as Record<string, any> | undefined
      const properties = schema?.properties ?? {}

      for (const [key, value] of Object.entries(state.toolParams)) {
        const propSchema = properties[key]
        if (!propSchema) {
          arguments_[key] = value
          continue
        }

        // Try to parse JSON values for object/array types
        if (propSchema.type === 'object' || propSchema.type === 'array') {
          try {
            arguments_[key] = JSON.parse(value)
          } catch {
            arguments_[key] = value
          }
        } else if (propSchema.type === 'number') {
          arguments_[key] = Number(value)
        } else if (propSchema.type === 'boolean') {
          arguments_[key] = value === 'true'
        } else {
          arguments_[key] = value
        }
      }

      const payload: JsonRpcPayload = {
        jsonrpc: '2.0',
        id: 100,
        method: 'tools/call',
        params: {
          name: state.selectedTool.name,
          arguments: arguments_,
        },
      }

      const response = await callMcpInspect(state.selectedId, payload)

      setState((prev) => ({
        ...prev,
        callLoading: false,
        callResult: response,
      }))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to call tool'
      setState((prev) => ({
        ...prev,
        callLoading: false,
        error: message,
        callResult: null,
      }))
    }
  }, [state.selectedId, state.selectedTool, state.toolParams])

  const callPing = useCallback(async () => {
    if (!state.selectedId) return

    setState((prev) => ({ ...prev, callLoading: true, error: null }))
    try {
      const startTime = Date.now()
      const payload: JsonRpcPayload = {
        jsonrpc: '2.0',
        id: 101,
        method: 'ping',
        params: {},
      }

      const response = await callMcpInspect(state.selectedId, payload)
      const latency = Date.now() - startTime

      setState((prev) => ({
        ...prev,
        callLoading: false,
        callResult: {
          ...response,
          result: { ...((response.result as any) || {}), latencyMs: latency },
        },
      }))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ping failed'
      setState((prev) => ({
        ...prev,
        callLoading: false,
        error: message,
        callResult: null,
      }))
    }
  }, [state.selectedId])

  const callRoots = useCallback(async () => {
    if (!state.selectedId) return

    setState((prev) => ({ ...prev, callLoading: true, error: null }))
    try {
      const payload: JsonRpcPayload = {
        jsonrpc: '2.0',
        id: 102,
        method: 'roots/list',
        params: {},
      }

      const response = await callMcpInspect(state.selectedId, payload)

      setState((prev) => ({
        ...prev,
        callLoading: false,
        callResult: response,
      }))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to list roots'
      setState((prev) => ({
        ...prev,
        callLoading: false,
        error: message,
        callResult: null,
      }))
    }
  }, [state.selectedId])

  // Auto-fetch when selectedId changes and activeTab is 'tools'
  useEffect(() => {
    if (state.selectedId && state.activeTab === 'tools' && state.tools.length === 0) {
      void fetchTools()
    }
  }, [state.selectedId, state.activeTab, state.tools.length, fetchTools])

  // Auto-fetch when activeTab changes
  useEffect(() => {
    if (!state.selectedId) return

    if (state.activeTab === 'tools' && state.tools.length === 0) {
      void fetchTools()
    } else if (state.activeTab === 'resources' && state.resources.length === 0) {
      void fetchResources()
    } else if (state.activeTab === 'prompts' && state.prompts.length === 0) {
      void fetchPrompts()
    }
  }, [state.activeTab, state.selectedId, state.tools.length, state.resources.length, state.prompts.length, fetchTools, fetchResources, fetchPrompts])

  return {
    state,
    setSelectedId,
    setActiveTab,
    setSelectedTool,
    setToolParam,
    fetchTools,
    fetchResources,
    fetchPrompts,
    callTool,
    callPing,
    callRoots,
  }
}
