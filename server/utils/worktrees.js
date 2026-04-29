import { spawn } from 'child_process';
import path from 'path';
import { promises as fs } from 'fs';

const WORKTREES_SUBDIR = '.worktrees';
const NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._\/-]*$/;
const RESERVED_REF_FRAGMENTS = ['..', '@{', '\\', ' ', '~', '^', ':', '?', '*', '['];

function spawnAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });
    child.on('error', (error) => { reject(error); });
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const error = new Error(`Command failed: ${command} ${args.join(' ')} (exit ${code})`);
      error.code = code;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

async function git(args, cwd) {
  return spawnAsync('git', args, { cwd });
}

const repoInfoCache = new Map();

export function clearRepoInfoCache(forPath) {
  if (forPath) {
    repoInfoCache.delete(path.resolve(forPath));
  } else {
    repoInfoCache.clear();
  }
}

/**
 * Resolve git info for a path. Returns null if the path is not inside a git work tree.
 * Result shape: { commonDir, gitDir, isMainWorktree, branch, repoBasename, mainWorktreePath }
 */
async function realpathSafe(p) {
  try { return await fs.realpath(p); } catch { return path.resolve(p); }
}

/**
 * Add lines to the repo's local .git/info/exclude (shared via common-dir).
 * Idempotent: only appends lines not already present. Used to keep the main worktree
 * from showing .worktrees/ and the symlinked node_modules as untracked.
 */
async function ensureExcludes(commonDir, linesToEnsure) {
  const excludePath = path.join(commonDir, 'info', 'exclude');
  let current = '';
  try {
    current = await fs.readFile(excludePath, 'utf8');
  } catch {
    await fs.mkdir(path.dirname(excludePath), { recursive: true });
  }
  const existing = new Set(current.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
  const additions = linesToEnsure.filter((l) => !existing.has(l));
  if (additions.length === 0) return;
  const trailing = current.length === 0 || current.endsWith('\n') ? '' : '\n';
  const block = `${trailing}# claudecodeui worktrees\n${additions.join('\n')}\n`;
  await fs.writeFile(excludePath, current + block, 'utf8');
}

export async function getRepoInfo(targetPath) {
  if (!targetPath) return null;
  const resolved = path.resolve(targetPath);
  if (repoInfoCache.has(resolved)) return repoInfoCache.get(resolved);

  let info = null;
  try {
    await fs.access(resolved);
    const [absGitDir, commonDirRaw] = await Promise.all([
      git(['rev-parse', '--absolute-git-dir'], resolved).then((r) => r.stdout.trim()),
      git(['rev-parse', '--git-common-dir'], resolved).then((r) => r.stdout.trim()),
    ]);
    const commonDirAbs = path.isAbsolute(commonDirRaw)
      ? commonDirRaw
      : path.resolve(resolved, commonDirRaw);

    // Normalize both via realpath to dodge symlink mismatches (e.g. macOS /tmp -> /private/tmp).
    const [gitDirReal, commonDirReal] = await Promise.all([
      realpathSafe(absGitDir),
      realpathSafe(commonDirAbs),
    ]);
    const isMainWorktree = gitDirReal === commonDirReal;

    let branch = null;
    try {
      const { stdout } = await git(['symbolic-ref', '--quiet', '--short', 'HEAD'], resolved);
      branch = stdout.trim() || null;
    } catch {
      branch = null;
    }

    const mainWorktreePath = await realpathSafe(path.dirname(commonDirReal));
    const repoBasename = path.basename(mainWorktreePath) || path.basename(commonDirReal).replace(/\.git$/, '');

    info = {
      commonDir: commonDirReal,
      gitDir: gitDirReal,
      isMainWorktree,
      branch,
      repoBasename,
      mainWorktreePath,
    };
  } catch {
    info = null;
  }

  repoInfoCache.set(resolved, info);
  return info;
}

/**
 * Parse `git worktree list --porcelain` output into structured records.
 */
function parseWorktreeList(stdout) {
  const blocks = stdout.split(/\n{2,}/);
  const worktrees = [];
  for (const block of blocks) {
    if (!block.trim()) continue;
    const wt = {
      path: null,
      head: null,
      branch: null,
      isDetached: false,
      isBare: false,
      isLocked: false,
      lockReason: null,
      isPrunable: false,
      prunableReason: null,
    };
    for (const line of block.split('\n')) {
      if (!line) continue;
      if (line.startsWith('worktree ')) {
        wt.path = line.slice('worktree '.length);
      } else if (line.startsWith('HEAD ')) {
        wt.head = line.slice('HEAD '.length);
      } else if (line.startsWith('branch ')) {
        wt.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
      } else if (line === 'detached') {
        wt.isDetached = true;
      } else if (line === 'bare') {
        wt.isBare = true;
      } else if (line.startsWith('locked')) {
        wt.isLocked = true;
        wt.lockReason = line.slice('locked'.length).trim() || null;
      } else if (line.startsWith('prunable')) {
        wt.isPrunable = true;
        wt.prunableReason = line.slice('prunable'.length).trim() || null;
      }
    }
    if (wt.path) worktrees.push(wt);
  }
  return worktrees;
}

/**
 * List all worktrees of a git repo (any path inside the repo works).
 * Returns enriched records including isMain (true for the main worktree).
 */
export async function listWorktrees(repoPath) {
  const info = await getRepoInfo(repoPath);
  if (!info) throw new Error('Not a git repository');
  const { stdout } = await git(['worktree', 'list', '--porcelain'], info.mainWorktreePath);
  const worktrees = parseWorktreeList(stdout);
  return worktrees.map((wt) => {
    const wtPath = path.resolve(wt.path);
    return {
      ...wt,
      path: wtPath,
      isMain: wtPath === path.resolve(info.mainWorktreePath),
    };
  });
}

/**
 * Validate a task name. Throws if invalid.
 * Used both for branch name and worktree directory name.
 */
export function validateTaskName(name) {
  if (typeof name !== 'string') throw new Error('Task name is required');
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Task name cannot be empty');
  if (trimmed.length > 100) throw new Error('Task name too long (max 100 chars)');
  if (!NAME_REGEX.test(trimmed)) {
    throw new Error('Task name must contain only letters, numbers, ., _, -, /');
  }
  for (const frag of RESERVED_REF_FRAGMENTS) {
    if (trimmed.includes(frag)) {
      throw new Error(`Task name contains invalid sequence: "${frag}"`);
    }
  }
  if (trimmed.endsWith('/') || trimmed.endsWith('.lock') || trimmed.endsWith('.')) {
    throw new Error('Task name cannot end with "/", "." or ".lock"');
  }
  return trimmed;
}

/**
 * Best-effort copy of .mcp.json from main into the new worktree.
 * Copy (not symlink) so each worktree can diverge its MCP config without
 * surprising the main repo. No-op if main has no .mcp.json or dest already exists.
 */
export async function copyMcpJson(mainPath, worktreePath) {
  const src = path.join(mainPath, '.mcp.json');
  const dest = path.join(worktreePath, '.mcp.json');
  try {
    await fs.access(src);
  } catch {
    return { copied: false, reason: 'src-missing' };
  }
  try {
    await fs.lstat(dest);
    return { copied: false, reason: 'dest-exists' };
  } catch {
    // dest missing — good
  }
  await fs.copyFile(src, dest);
  return { copied: true };
}

/**
 * Best-effort symlink of node_modules from main into the new worktree.
 * No-op if main has no node_modules.
 */
export async function symlinkNodeModules(mainPath, worktreePath) {
  const src = path.join(mainPath, 'node_modules');
  const dest = path.join(worktreePath, 'node_modules');
  try {
    const stat = await fs.lstat(src);
    if (!stat.isDirectory() && !stat.isSymbolicLink()) return { linked: false, reason: 'src-not-a-dir' };
  } catch {
    return { linked: false, reason: 'src-missing' };
  }
  try {
    await fs.lstat(dest);
    return { linked: false, reason: 'dest-exists' };
  } catch {
    // dest missing — good
  }
  await fs.symlink(src, dest, 'dir');
  return { linked: true };
}

/**
 * Create a new task: branch <name> from current main HEAD,
 * worktree at <repo>/.worktrees/<name>, symlink node_modules.
 */
export async function createTask({ repoPath, name }) {
  const taskName = validateTaskName(name);
  const info = await getRepoInfo(repoPath);
  if (!info) throw new Error('Not a git repository');

  const mainPath = info.mainWorktreePath;
  const worktreePath = path.join(mainPath, WORKTREES_SUBDIR, taskName);

  // Ensure repo has at least one commit
  try {
    await git(['rev-parse', '--verify', 'HEAD'], mainPath);
  } catch {
    throw new Error('Repo needs at least one commit to create tasks');
  }

  const branchExists = await git(['rev-parse', '--verify', `refs/heads/${taskName}`], mainPath)
    .then(() => true)
    .catch(() => false);
  if (branchExists) throw new Error(`Branch already exists: ${taskName}`);

  const pathExists = await fs.access(worktreePath).then(() => true).catch(() => false);
  if (pathExists) throw new Error(`Worktree path already exists: ${worktreePath}`);

  // Ensure parent .worktrees dir
  await fs.mkdir(path.join(mainPath, WORKTREES_SUBDIR), { recursive: true });

  // Add .worktrees and node_modules to repo-local exclude so neither shows as untracked.
  // node_modules is added without trailing slash so it matches symlinks too.
  await ensureExcludes(info.commonDir, ['.worktrees/', 'node_modules']).catch(() => {});

  // Create worktree with new branch from current HEAD of main
  await git(['worktree', 'add', '-b', taskName, worktreePath, 'HEAD'], mainPath);

  // Best-effort symlink
  let symlinkResult = { linked: false, reason: 'unknown' };
  try {
    symlinkResult = await symlinkNodeModules(mainPath, worktreePath);
  } catch (err) {
    symlinkResult = { linked: false, reason: `symlink-failed: ${err.message}` };
  }

  // Best-effort copy of .mcp.json so MCP servers with scope=project are available
  // in the worktree (the file is gitignored, so it won't come along via git).
  let mcpCopyResult = { copied: false, reason: 'unknown' };
  try {
    mcpCopyResult = await copyMcpJson(mainPath, worktreePath);
  } catch (err) {
    mcpCopyResult = { copied: false, reason: `copy-failed: ${err.message}` };
  }

  clearRepoInfoCache(worktreePath);
  clearRepoInfoCache(mainPath);

  return {
    path: worktreePath,
    branch: taskName,
    mainWorktreePath: mainPath,
    nodeModulesSymlink: symlinkResult,
    mcpJsonCopy: mcpCopyResult,
  };
}

/**
 * Remove a worktree. If `force`, allow even with uncommitted changes.
 */
export async function removeTask({ worktreePath, force = false }) {
  const resolved = path.resolve(worktreePath);
  const info = await getRepoInfo(resolved);
  if (!info) throw new Error('Path is not inside a git repository');
  if (info.isMainWorktree) throw new Error('Refusing to remove the main worktree');

  const args = ['worktree', 'remove'];
  if (force) args.push('--force');
  args.push(resolved);

  await git(args, info.mainWorktreePath);
  clearRepoInfoCache(resolved);
  clearRepoInfoCache(info.mainWorktreePath);
}

/**
 * Quick "has uncommitted changes" check for a worktree path.
 */
export async function hasUncommittedChanges(worktreePath) {
  try {
    const { stdout } = await git(['status', '--porcelain'], worktreePath);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export const WORKTREES_DIRNAME = WORKTREES_SUBDIR;
