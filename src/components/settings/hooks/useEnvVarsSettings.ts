import { useCallback, useEffect, useState } from 'react';
import { authenticatedFetch } from '../../../utils/api';

export type EnvVar = {
  name: string;
  value: string;
  updated_at?: string;
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

  useEffect(() => {
    void load();
  }, [load]);

  return {
    vars,
    isLoading,
    error,
    reload: load,
    upsert,
    remove,
  };
}
