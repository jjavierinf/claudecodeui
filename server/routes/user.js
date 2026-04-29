import express from 'express';
import { userDb, userEnvVarsDb } from '../database/db.js';
import { authenticateToken } from '../middleware/auth.js';
import { getSystemGitConfig } from '../utils/gitConfig.js';
import { invalidateUserEnv, isValidEnvVarName } from '../utils/userEnv.js';
import { abortClaudeSDKSession, getActiveClaudeSDKSessions } from '../claude-sdk.js';
import { abortCursorSession, getActiveCursorSessions } from '../cursor-cli.js';
import { abortCodexSession, getActiveCodexSessions } from '../openai-codex.js';
import { abortGeminiSession, getActiveGeminiSessions } from '../gemini-cli.js';
import { spawn } from 'child_process';

const router = express.Router();

function spawnAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });
    child.on('error', (error) => { reject(error); });
    child.on('close', (code) => {
      if (code === 0) { resolve({ stdout, stderr }); return; }
      const error = new Error(`Command failed: ${command} ${args.join(' ')}`);
      error.code = code;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

router.get('/git-config', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    let gitConfig = userDb.getGitConfig(userId);

    // If database is empty, try to get from system git config
    if (!gitConfig || (!gitConfig.git_name && !gitConfig.git_email)) {
      const systemConfig = await getSystemGitConfig();

      // If system has values, save them to database for this user
      if (systemConfig.git_name || systemConfig.git_email) {
        userDb.updateGitConfig(userId, systemConfig.git_name, systemConfig.git_email);
        gitConfig = systemConfig;
        console.log(`Auto-populated git config from system for user ${userId}: ${systemConfig.git_name} <${systemConfig.git_email}>`);
      }
    }

    res.json({
      success: true,
      gitName: gitConfig?.git_name || null,
      gitEmail: gitConfig?.git_email || null
    });
  } catch (error) {
    console.error('Error getting git config:', error);
    res.status(500).json({ error: 'Failed to get git configuration' });
  }
});

// Apply git config globally via git config --global
router.post('/git-config', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { gitName, gitEmail } = req.body;

    if (!gitName || !gitEmail) {
      return res.status(400).json({ error: 'Git name and email are required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(gitEmail)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    userDb.updateGitConfig(userId, gitName, gitEmail);

    try {
      await spawnAsync('git', ['config', '--global', 'user.name', gitName]);
      await spawnAsync('git', ['config', '--global', 'user.email', gitEmail]);
      console.log(`Applied git config globally: ${gitName} <${gitEmail}>`);
    } catch (gitError) {
      console.error('Error applying git config:', gitError);
    }

    res.json({
      success: true,
      gitName,
      gitEmail
    });
  } catch (error) {
    console.error('Error updating git config:', error);
    res.status(500).json({ error: 'Failed to update git configuration' });
  }
});

router.post('/complete-onboarding', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    userDb.completeOnboarding(userId);

    res.json({
      success: true,
      message: 'Onboarding completed successfully'
    });
  } catch (error) {
    console.error('Error completing onboarding:', error);
    res.status(500).json({ error: 'Failed to complete onboarding' });
  }
});

router.get('/onboarding-status', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const hasCompleted = userDb.hasCompletedOnboarding(userId);

    res.json({
      success: true,
      hasCompletedOnboarding: hasCompleted
    });
  } catch (error) {
    console.error('Error checking onboarding status:', error);
    res.status(500).json({ error: 'Failed to check onboarding status' });
  }
});

// Per-user environment variables. Injected into spawns (MCPs, provider CLIs, shell)
// so each user can override env without touching the server start script.
router.get('/env-vars', authenticateToken, (req, res) => {
  try {
    const vars = userEnvVarsDb.list(req.user.id);
    res.json({ success: true, vars });
  } catch (error) {
    console.error('Error listing user env vars:', error);
    res.status(500).json({ error: 'Failed to list environment variables' });
  }
});

router.put('/env-vars', authenticateToken, (req, res) => {
  try {
    const { name, value } = req.body || {};
    if (!isValidEnvVarName(name)) {
      return res.status(400).json({ error: 'Invalid name. Use [A-Z_][A-Z0-9_]*, max 256 chars.' });
    }
    if (typeof value !== 'string') {
      return res.status(400).json({ error: 'Value must be a string' });
    }
    userEnvVarsDb.upsert(req.user.id, name, value);
    invalidateUserEnv(req.user.id);
    res.json({ success: true, name, value });
  } catch (error) {
    console.error('Error upserting user env var:', error);
    res.status(500).json({ error: 'Failed to save environment variable' });
  }
});

// Abort all active provider sessions so a follow-up message respawns MCPs/CLIs
// with the latest per-user env. JSONL chat history is preserved on disk; only
// the live process is interrupted. Single-user scoping for now — once active-
// session bookkeeping tracks userId, this will filter to req.user.id only.
router.post('/restart-sessions', authenticateToken, async (req, res) => {
  const result = { claude: 0, cursor: 0, codex: 0, gemini: 0, errors: [] };
  try {
    for (const id of getActiveClaudeSDKSessions()) {
      try { await abortClaudeSDKSession(id); result.claude++; } catch (e) { result.errors.push(`claude:${id}:${e.message}`); }
    }
    for (const id of getActiveCursorSessions()) {
      try { abortCursorSession(id); result.cursor++; } catch (e) { result.errors.push(`cursor:${id}:${e.message}`); }
    }
    for (const id of getActiveCodexSessions()) {
      try { abortCodexSession(id); result.codex++; } catch (e) { result.errors.push(`codex:${id}:${e.message}`); }
    }
    for (const id of getActiveGeminiSessions()) {
      try { abortGeminiSession(id); result.gemini++; } catch (e) { result.errors.push(`gemini:${id}:${e.message}`); }
    }
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error restarting sessions:', error);
    res.status(500).json({ error: 'Failed to restart sessions', ...result });
  }
});

router.get('/active-sessions-count', authenticateToken, (_req, res) => {
  try {
    res.json({
      success: true,
      claude: getActiveClaudeSDKSessions().length,
      cursor: getActiveCursorSessions().length,
      codex: getActiveCodexSessions().length,
      gemini: getActiveGeminiSessions().length,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to count active sessions' });
  }
});

router.delete('/env-vars/:name', authenticateToken, (req, res) => {
  try {
    const { name } = req.params;
    if (!isValidEnvVarName(name)) {
      return res.status(400).json({ error: 'Invalid name' });
    }
    const removed = userEnvVarsDb.remove(req.user.id, name);
    invalidateUserEnv(req.user.id);
    res.json({ success: true, removed });
  } catch (error) {
    console.error('Error deleting user env var:', error);
    res.status(500).json({ error: 'Failed to delete environment variable' });
  }
});

export default router;
