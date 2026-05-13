import { useCallback, useEffect, useState } from 'react';
import {
  deployMcp,
  getHttpHealth,
  getStdioHealth,
  listMcps,
  runMcpAction,
  updateMcp,
} from '../services/api';
import type { HttpHealthResult, StdioHealthState } from '../types/health';
import type { DeployPayload, McpContainer } from '../types/mcp';
import { toErrorMessage } from '../utils/error';

export function useMcps() {
  const [mcps, setMcps] = useState<McpContainer[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<
    Record<string, string | null>
  >({});
  const [stdioHealth, setStdioHealth] = useState<
    Record<string, StdioHealthState>
  >({});
  const [stdioHealthLoading, setStdioHealthLoading] = useState<
    Record<string, boolean>
  >({});
  const [httpHealth, setHttpHealth] = useState<
    Record<string, HttpHealthResult>
  >({});
  const [httpHealthLoading, setHttpHealthLoading] = useState<
    Record<string, boolean>
  >({});

  const refreshMcps = useCallback(async () => {
    try {
      const data = await listMcps();
      setMcps(data);
    } catch {
      // Retry will happen in the polling interval.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshMcps();
    const interval = setInterval(refreshMcps, 5000);
    return () => clearInterval(interval);
  }, [refreshMcps]);

  const handleDeploy = useCallback(
    async (formData: DeployPayload) => {
      await deployMcp(formData);
      await refreshMcps();
    },
    [refreshMcps]
  );

  const handleUpdate = useCallback(
    async (id: string, formData: DeployPayload) => {
      await updateMcp(id, formData);
      await refreshMcps();
    },
    [refreshMcps]
  );

  const handleAction = useCallback(
    async (id: string, action: string) => {
      setActionLoading((prev) => ({ ...prev, [id]: action }));
      try {
        await runMcpAction(id, action);
        await refreshMcps();
      } finally {
        setActionLoading((prev) => ({ ...prev, [id]: null }));
      }
    },
    [refreshMcps]
  );

  const handleCheckStdioHealth = useCallback(async (id: string) => {
    setStdioHealthLoading((prev) => ({ ...prev, [id]: true }));
    try {
      const data = await getStdioHealth(id);
      setStdioHealth((prev) => ({ ...prev, [id]: data }));
    } catch (err) {
      setStdioHealth((prev) => ({
        ...prev,
        [id]: {
          status: 'unhealthy',
          networkProbe: {
            attempted: false,
            ok: false,
            error: toErrorMessage(err, 'Health check failed'),
          },
        },
      }));
    } finally {
      setStdioHealthLoading((prev) => ({ ...prev, [id]: false }));
    }
  }, []);

  const handleCheckHttpHealth = useCallback(async (id: string) => {
    setHttpHealthLoading((prev) => ({ ...prev, [id]: true }));
    try {
      const data = await getHttpHealth(id);
      setHttpHealth((prev) => ({ ...prev, [id]: data }));
    } catch (err) {
      setHttpHealth((prev) => ({
        ...prev,
        [id]: {
          id,
          transport: 'http',
          status: 'error',
          error: toErrorMessage(err, 'Health check failed'),
          checkedAt: new Date().toISOString(),
        },
      }));
    } finally {
      setHttpHealthLoading((prev) => ({ ...prev, [id]: false }));
    }
  }, []);

  return {
    mcps,
    loading,
    actionLoading,
    stdioHealth,
    stdioHealthLoading,
    httpHealth,
    httpHealthLoading,
    handleDeploy,
    handleUpdate,
    handleAction,
    handleCheckStdioHealth,
    handleCheckHttpHealth,
  };
}
