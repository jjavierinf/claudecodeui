import { userEnvVarsDb } from '../database/db.js';

// Cache user env reads — spawn sites hit this every time a session/MCP/shell starts.
// Cache is invalidated whenever the user updates a var.
const cache = new Map();

const VALID_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isValidEnvVarName(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= 256 && VALID_NAME.test(name);
}

// Returns a plain { NAME: value } object for merging into spawn env.
// Returns {} for null/undefined userId so callers don't need to guard.
export function getUserEnv(userId) {
  if (!userId) return {};
  if (cache.has(userId)) return cache.get(userId);
  const env = userEnvVarsDb.asObject(userId);
  cache.set(userId, env);
  return env;
}

export function invalidateUserEnv(userId) {
  if (userId == null) {
    cache.clear();
    return;
  }
  cache.delete(userId);
}
