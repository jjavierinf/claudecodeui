# claudecodeui — worktrees as tasks

**Date:** 2026-04-29
**Status:** approved, in implementation

## Goal

Force every Claude session opened in claudecodeui over a git repo to run inside a git worktree separate from the main checkout. Make a "task" (= branch + worktree + sessions) the only way to start working. The main checkout becomes read-only in the UI: existing sessions are visible as transcripts, no new sessions allowed.

Non-git folders keep current behavior (legacy mode).

## Why

- Multiple parallel Claude sessions on the same repo shouldn't fight over the working tree.
- Match the parallel-code / Crystal mental model: task = branch + worktree, created on demand.
- Layer with the existing pty/dags hook (`CLAUDE_VIA_WEBUI=1` blocks edits on main) — defense-in-depth.

## Concepts

- **Project (UI)**: a git repo, identified by `git common-dir`. Groups all its tasks. For non-git folders, the legacy single-folder project model.
- **Task**: one branch + one worktree + its sessions. Unit of parallel work.
- **Session**: unchanged structurally; its `cwd` always points at a non-main worktree (for git projects).
- **Legacy project**: non-git folder. Kept as-is; sessions open directly on the folder.

## UX flow

### Sidebar
Git projects render as collapsible nodes grouping their tasks. The main task is shown but greyed with a `read-only` badge. Non-git projects render unchanged.

### Create task
- Trigger: `+` button on the repo node.
- Modal: single input for task name (e.g. `fix-login-bug`).
- On confirm:
  1. Create branch `<name>` from the main worktree's `HEAD`.
  2. Create worktree at `<repo>/.worktrees/<name>`.
  3. Symlink `node_modules` from main if it exists. Skip silently if not.
  4. Register the worktree path as a manual project (`addProjectManually`) if not already registered.
  5. Open the new task in the sidebar, ready for first session.
- Validation: name is a valid git ref (no spaces, no `..`, no leading `-`); branch and worktree path don't exist.

### Discovery
On expanding a repo node, the UI calls `git worktree list --porcelain` and displays every worktree. New worktrees (created via CLI outside the UI) get auto-registered as projects on the fly.

### Delete task
- Trigger: context menu / button on a task card (not available on main).
- Confirm dialog. If the worktree has uncommitted changes, second explicit prompt.
- Action: `git worktree remove <path>` (with `--force` if dirty was confirmed). Branch is left untouched (deletion is manual). Worktree is also deregistered from `~/.claude/project-config.json`.

### Main task — read-only
- Click on it shows existing sessions as transcripts only — no resume button, no new session.
- Banner: "Main worktree — create a task to work on this repo."

## Data model

No schema migration required.

- Each worktree continues to be its own claudecodeui project (one entry per cwd in `~/.claude/projects/`).
- Repo grouping computed at runtime: per project path, run `git rev-parse --git-common-dir` and group by resolved path.
- Optional caching: `~/.claude/project-config.json` gains an optional `parentRepoCommonDir` field per entry. Reconstructed from git on demand if missing.

## Backend

### New helper module: `server/utils/worktrees.js`
- `getRepoCommonDir(path)` — resolve `git rev-parse --git-common-dir`, cache by path.
- `listWorktrees(repoPath)` — parse `git worktree list --porcelain`. Returns `[{path, branch, head, isMain, isDetached, isPrunable, isLocked}]`.
- `createWorktree({repoPath, name, baseRef?})` — branch + add + symlink. Returns the resulting worktree path.
- `removeWorktree({path, force})` — wraps `git worktree remove`.
- `symlinkNodeModules(mainPath, worktreePath)` — best-effort symlink, no-op if main has no `node_modules`.
- `isMainWorktree(path)` — true iff `git common-dir` resolves to `<path>/.git` (i.e., not a linked worktree).

### New endpoints: in `server/routes/git.js`
| Method | Path | Body | Returns |
|---|---|---|---|
| `GET`    | `/api/git/tasks?repoPath=...`            | —                              | List of tasks (worktrees) for the repo, enriched with sessionCount. |
| `POST`   | `/api/git/tasks`                         | `{repoPath, name}`             | The newly created task. |
| `DELETE` | `/api/git/tasks`                         | `{worktreePath, force?}`       | `{ok: true}`. |

The `GET` also auto-registers any unknown worktrees as projects so the sidebar can use them as session containers without separate calls.

### Spawn guard: `server/claude-sdk.js`
Before invoking `query()`, if the resolved cwd is the main worktree of a git repo, throw a clear error: `"Open or create a task for this repo to start a session."` Keeps `CLAUDE_VIA_WEBUI=1` injection (already in place).

### Untouched
Session jsonl parsing, auth, MCP, cursor/codex/gemini wrappers.

## Frontend

Localized changes, no full sidebar rewrite.

- **`ProjectList` (sidebar)**: when a project has a resolvable `parentRepoCommonDir`, group siblings under a parent collapsible node. Parent label = basename of the common-dir minus `.git`.
- **`TaskCard`**: branch name, last-session timestamp, session count, `dirty` badge if uncommitted, `read-only` badge if main, `broken`/`prunable` badge if reported as such by git.
- **`NewTaskModal`**: single input + client-side regex validation; calls `POST /api/git/tasks`; on success, focuses the new task.
- **Session view on main**: when current cwd is the main worktree, hide the chat input and show a banner with a "Create a task" CTA.

## Edges

- Repo with no commits: branch creation fails. Modal surfaces a clear error: "Repo needs at least one commit to create tasks."
- Worktree path already exists: explicit error message.
- `node_modules` missing in main: silent skip.
- Worktree externally pruned/missing: shown with `broken` badge and a "Prune" action that runs `git worktree prune`.
- Multiple sessions per task: allowed; listed under the task.
- Symlinks on Windows: not supported in v1 (claudecodeui is Mac/Linux-first).

## Out of scope (v1)

- Merge/push/PR from the UI.
- `git init` for non-git folders.
- Symlinks beyond `node_modules` (e.g. `.venv`, `vendor`).
- Auto-deleting branches on task delete.
- Setup scripts / templates post-creation.
- Renaming tasks.

## Implementation order

1. Backend helper (`worktrees.js`) with unit-style smoke tests via a temp repo.
2. Backend endpoints in `routes/git.js`.
3. Spawn guard in `claude-sdk.js`.
4. Frontend grouping + read-only main badge (sidebar refactor scoped).
5. NewTaskModal + TaskCard + Delete flow.
6. Manual end-to-end test on `pty/dags` and one node project.
