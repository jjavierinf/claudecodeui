import { useCallback, useEffect, useState } from 'react';
import { authenticatedFetch } from '../../../utils/api';

export type EnvVar = {
  name: string;
  value: string;
  updated_at?: string;
};

export type ActiveSessionsCount = {
  claude: number;
  cursor: number;
  codex: number;
  gemini: number;
};

type ListResponse = {
  success?: boolean;
  vars?: EnvVar[];
  error?: string;
};

type MutationResponse = {
  success?: boolean;
  error?: string;
};

type RestartResponse = {
  success?: boolean;
  claude?: number;
  cursor?: number;
  codex?: number;
  gemini?: number;
  error?: string;
};

type ActiveCountResponse = ActiveSessionsCount & {
  success?: boolean;
  error?: string;
};

const VALID_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isValidEnvVarName(name: string): boolean {
  return name.length > 0 && name.length <= 256 && VALID_NAME.test(name);
}

export function useEnvVarsSettings() {
  const [vars, setVars] = useState<EnvVar[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await authenticatedFetch('/api/user/env-vars');
      const data = (await response.json()) as ListResponse;
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to load environment variables');
      }
      setVars(data.vars || []);
    } catch (err) {
      console.error('Error loading env vars:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const upsert = useCallback(async (name: string, value: string) => {
    setError(null);
    const response = await authenticatedFetch('/api/user/env-vars', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, value }),
    });
    const data = (await response.json()) as MutationResponse;
    if (!response.ok || !data.success) {
      const message = data.error || 'Failed to save';
      setError(message);
      throw new Error(message);
    }
    await load();
  }, [load]);

  const remove = useCallback(async (name: string) => {
    setError(null);
    const response = await authenticatedFetch(`/api/user/env-vars/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
    const data = (await response.json()) as MutationResponse;
    if (!response.ok || !data.success) {
      const message = data.error || 'Failed to delete';
      setError(message);
      throw new Error(message);
    }
    await load();
  }, [load]);

  const [activeCount, setActiveCount] = useState<ActiveSessionsCount>({ claude: 0, cursor: 0, codex: 0, gemini: 0 });

  const reloadActiveCount = useCallback(async () => {
    try {
      const response = await authenticatedFetch('/api/user/active-sessions-count');
      const data = (await response.json()) as ActiveCountResponse;
      if (response.ok && data.success) {
        setActiveCount({
          claude: data.claude || 0,
          cursor: data.cursor || 0,
          codex: data.codex || 0,
          gemini: data.gemini || 0,
        });
      }
    } catch (err) {
      console.error('Error loading active sessions count:', err);
    }
  }, []);

  const restartSessions = useCallback(async () => {
    setError(null);
    const response = await authenticatedFetch('/api/user/restart-sessions', { method: 'POST' });
    const data = (await response.json()) as RestartResponse;
    if (!response.ok || !data.success) {
      const message = data.error || 'Failed to restart sessions';
      setError(message);
      throw new Error(message);
    }
    await reloadActiveCount();
    return {
      claude: data.claude || 0,
      cursor: data.cursor || 0,
      codex: data.codex || 0,
      gemini: data.gemini || 0,
    };
  }, [reloadActiveCount]);

  useEffect(() => {
    void load();
    void reloadActiveCount();
  }, [load, reloadActiveCount]);

  return {
    vars,
    isLoading,
    error,
    reload: load,
    upsert,
    remove,
    activeCount,
    reloadActiveCount,
    restartSessions,
  };
}
