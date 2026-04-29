import { useState, useEffect, useRef } from 'react';
import { GitBranch, Loader2 } from 'lucide-react';
import { Button, Dialog, DialogContent, DialogTitle, Input } from '../../../../shared/view/ui';
import { api } from '../../../../utils/api';

const NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._\/-]*$/;
const RESERVED_FRAGMENTS = ['..', '@{', '\\', ' ', '~', '^', ':', '?', '*', '['];

function validateName(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Task name is required';
  if (trimmed.length > 100) return 'Task name too long (max 100 chars)';
  if (!NAME_REGEX.test(trimmed)) return 'Use letters, numbers, ., _, -, /';
  for (const f of RESERVED_FRAGMENTS) {
    if (trimmed.includes(f)) return `Cannot contain "${f}"`;
  }
  if (trimmed.endsWith('/') || trimmed.endsWith('.lock') || trimmed.endsWith('.')) {
    return 'Cannot end with "/", "." or ".lock"';
  }
  return null;
}

interface NewTaskModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoPath: string;
  repoName: string;
  onTaskCreated?: (taskProjectName: string, worktreePath: string) => void;
}

export default function NewTaskModal({ open, onOpenChange, repoPath, repoName, onTaskCreated }: NewTaskModalProps) {
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setServerError(null);
      // Slight delay to let the dialog mount
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const validationError = name.length === 0 ? null : validateName(name);
  const canSubmit = !submitting && name.trim().length > 0 && !validationError;

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setServerError(null);
    try {
      const res = await api.tasks.create(repoPath, name.trim());
      const data = await res.json();
      if (!res.ok) {
        setServerError(data?.error || 'Failed to create task');
        return;
      }
      onTaskCreated?.(data.task.projectName, data.task.path);
      onOpenChange(false);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Failed to create task');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-6">
        <DialogTitle>Create new task</DialogTitle>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <GitBranch className="size-4 text-muted-foreground" aria-hidden />
              New task in <span className="font-mono">{repoName}</span>
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Creates a branch and a git worktree at <code className="font-mono">.worktrees/&lt;name&gt;</code>.
              <br />
              <code className="font-mono">node_modules</code> is symlinked from the main worktree if it exists.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Task name
            </label>
            <Input
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="fix-login-bug"
              autoComplete="off"
              spellCheck={false}
              disabled={submitting}
              className="font-mono"
            />
            {validationError && (
              <p className="mt-1 text-xs text-destructive">{validationError}</p>
            )}
            {!validationError && name && (
              <p className="mt-1 text-xs text-muted-foreground">
                Branch: <code className="font-mono">{name.trim()}</code> · Worktree: <code className="font-mono">.worktrees/{name.trim()}</code>
              </p>
            )}
          </div>

          {serverError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {serverError}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {submitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              Create task
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
