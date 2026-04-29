import { Plus, Trash2, Check, X as XIcon, Pencil, RotateCw } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input } from '../../../../../shared/view/ui';
import SettingsCard from '../../SettingsCard';
import SettingsSection from '../../SettingsSection';
import { useEnvVarsSettings, isValidEnvVarName } from '../../../hooks/useEnvVarsSettings';

export default function EnvVarsSettingsTab() {
  const { t } = useTranslation('settings');
  const { vars, isLoading, error, upsert, remove, activeCount, restartSessions } = useEnvVarsSettings();

  const [newName, setNewName] = useState('');
  const [newValue, setNewValue] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [editing, setEditing] = useState<{ name: string; value: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [restartFeedback, setRestartFeedback] = useState<string | null>(null);

  const newNameValid = newName.length === 0 || isValidEnvVarName(newName);

  const handleAdd = async () => {
    if (!isValidEnvVarName(newName)) return;
    setBusy(true);
    try {
      await upsert(newName, newValue);
      setNewName('');
      setNewValue('');
      setIsAdding(false);
    } catch {
      // Error is surfaced via the hook's `error` field
    } finally {
      setBusy(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await upsert(editing.name, editing.value);
      setEditing(null);
    } catch {
      // Error surfaced via hook
    } finally {
      setBusy(false);
    }
  };

  const totalActive = activeCount.claude + activeCount.cursor + activeCount.codex + activeCount.gemini;

  const handleRestart = async () => {
    setBusy(true);
    setRestartFeedback(null);
    try {
      const counts = await restartSessions();
      const total = counts.claude + counts.cursor + counts.codex + counts.gemini;
      setRestartFeedback(
        total === 0
          ? t('envVars.restartNone', { defaultValue: 'No active sessions to restart.' })
          : t('envVars.restartDone', {
              count: total,
              defaultValue: `Restarted ${total} session${total === 1 ? '' : 's'}. Send a message to spawn fresh MCPs with new env.`,
            }),
      );
      window.setTimeout(() => setRestartFeedback(null), 5000);
    } catch {
      // Error surfaced via hook's `error`
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (name: string) => {
    if (!window.confirm(t('envVars.confirmDelete', { name, defaultValue: `Delete ${name}?` }))) return;
    setBusy(true);
    try {
      await remove(name);
    } catch {
      // Error surfaced via hook
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-8">
      <SettingsSection
        title={t('envVars.title', { defaultValue: 'Environment Variables' })}
        description={t('envVars.description', {
          defaultValue:
            'Per-user env vars that are merged into anything spawned from your sessions: MCP servers, the shell, and provider CLIs (Gemini, Cursor). Changes only apply to new sessions/MCPs — restart any in-flight ones to pick them up.',
        })}
      >
        <SettingsCard className="p-4">
          {error && (
            <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {isLoading ? (
            <p className="text-sm text-muted-foreground">{t('common.loading', { defaultValue: 'Loading...' })}</p>
          ) : vars.length === 0 && !isAdding ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <p className="text-sm text-muted-foreground">
                {t('envVars.empty', { defaultValue: 'No environment variables yet.' })}
              </p>
              <Button onClick={() => setIsAdding(true)}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                {t('envVars.add', { defaultValue: 'Add variable' })}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {vars.map((v) => {
                const isEditing = editing?.name === v.name;
                return (
                  <div
                    key={v.name}
                    className="flex flex-col gap-2 rounded-md border border-border/60 bg-muted/30 p-3 sm:flex-row sm:items-center"
                  >
                    <div className="font-mono text-sm font-medium text-foreground sm:w-48 sm:flex-shrink-0">
                      {v.name}
                    </div>
                    <div className="flex-1 min-w-0">
                      {isEditing ? (
                        <Input
                          value={editing.value}
                          onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                          className="font-mono text-sm"
                          autoFocus
                        />
                      ) : (
                        <div className="truncate font-mono text-sm text-muted-foreground" title={v.value}>
                          {v.value || <span className="italic opacity-60">(empty)</span>}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-shrink-0 gap-1">
                      {isEditing ? (
                        <>
                          <Button size="sm" variant="ghost" onClick={handleSaveEdit} disabled={busy}>
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditing(null)} disabled={busy}>
                            <XIcon className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditing({ name: v.name, value: v.value })}
                            disabled={busy}
                            title={t('envVars.edit', { defaultValue: 'Edit' })}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDelete(v.name)}
                            disabled={busy}
                            className="text-destructive hover:text-destructive"
                            title={t('envVars.delete', { defaultValue: 'Delete' })}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}

              {isAdding ? (
                <div className="flex flex-col gap-2 rounded-md border border-primary/40 bg-primary/5 p-3 sm:flex-row sm:items-center">
                  <Input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="MY_API_KEY"
                    className={`font-mono text-sm sm:w-48 ${!newNameValid ? 'border-destructive' : ''}`}
                    autoFocus
                  />
                  <Input
                    value={newValue}
                    onChange={(e) => setNewValue(e.target.value)}
                    placeholder={t('envVars.valuePlaceholder', { defaultValue: 'value' })}
                    className="flex-1 font-mono text-sm"
                  />
                  <div className="flex flex-shrink-0 gap-1">
                    <Button
                      size="sm"
                      onClick={handleAdd}
                      disabled={busy || !isValidEnvVarName(newName)}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setIsAdding(false);
                        setNewName('');
                        setNewValue('');
                      }}
                      disabled={busy}
                    >
                      <XIcon className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="pt-2">
                  <Button size="sm" variant="outline" onClick={() => setIsAdding(true)} disabled={busy}>
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    {t('envVars.add', { defaultValue: 'Add variable' })}
                  </Button>
                </div>
              )}
            </div>
          )}

          {!newNameValid && (
            <p className="mt-2 text-xs text-destructive">
              {t('envVars.invalidName', {
                defaultValue: 'Name must match [A-Za-z_][A-Za-z0-9_]* and be ≤ 256 chars.',
              })}
            </p>
          )}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title={t('envVars.applyTitle', { defaultValue: 'Apply to running sessions' })}
        description={t('envVars.applyDescription', {
          defaultValue:
            'MCPs and provider CLIs that are already running won\'t see env changes. Restart aborts active sessions gracefully — chat history is preserved on disk; the next message respawns MCPs with the new env.',
        })}
      >
        <SettingsCard className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-muted-foreground">
              {totalActive === 0
                ? t('envVars.noActive', { defaultValue: 'No active sessions.' })
                : t('envVars.activeSummary', {
                    count: totalActive,
                    defaultValue: `${totalActive} active session${totalActive === 1 ? '' : 's'}: ` +
                      [
                        activeCount.claude && `${activeCount.claude} agent`,
                        activeCount.cursor && `${activeCount.cursor} cursor`,
                        activeCount.codex && `${activeCount.codex} codex`,
                        activeCount.gemini && `${activeCount.gemini} gemini`,
                      ].filter(Boolean).join(', '),
                  })}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRestart}
              disabled={busy}
            >
              <RotateCw className="mr-1.5 h-3.5 w-3.5" />
              {t('envVars.restart', { defaultValue: 'Restart sessions' })}
            </Button>
          </div>
          {restartFeedback && (
            <p className="mt-3 text-sm text-green-600 dark:text-green-400">{restartFeedback}</p>
          )}
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}
