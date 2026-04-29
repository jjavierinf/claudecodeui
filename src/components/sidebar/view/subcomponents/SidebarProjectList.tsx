import { useEffect, useMemo, useState } from 'react';
import type { TFunction } from 'i18next';
import { Folder, Plus } from 'lucide-react';
import { Button } from '../../../../shared/view/ui';
import { cn } from '../../../../lib/utils';
import type { LoadingProgress, Project, ProjectSession, LLMProvider } from '../../../../types/app';
import type {
  LoadingSessionsByProject,
  MCPServerStatus,
  SessionWithProvider,
} from '../../types/types';
import SidebarProjectItem from './SidebarProjectItem';
import SidebarProjectsState from './SidebarProjectsState';
import NewTaskModal from './NewTaskModal';

export type SidebarProjectListProps = {
  projects: Project[];
  filteredProjects: Project[];
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  isLoading: boolean;
  loadingProgress: LoadingProgress | null;
  expandedProjects: Set<string>;
  editingProject: string | null;
  editingName: string;
  loadingSessions: LoadingSessionsByProject;
  initialSessionsLoaded: Set<string>;
  currentTime: Date;
  editingSession: string | null;
  editingSessionName: string;
  deletingProjects: Set<string>;
  tasksEnabled: boolean;
  mcpServerStatus: MCPServerStatus;
  getProjectSessions: (project: Project) => SessionWithProvider[];
  isProjectStarred: (projectName: string) => boolean;
  onEditingNameChange: (value: string) => void;
  onToggleProject: (projectName: string) => void;
  onProjectSelect: (project: Project) => void;
  onToggleStarProject: (projectName: string) => void;
  onStartEditingProject: (project: Project) => void;
  onCancelEditingProject: () => void;
  onSaveProjectName: (projectName: string) => void;
  onDeleteProject: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onDeleteSession: (
    projectName: string,
    sessionId: string,
    sessionTitle: string,
    provider: LLMProvider,
  ) => void;
  onLoadMoreSessions: (project: Project) => void;
  onNewSession: (project: Project) => void;
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  onProjectsRefresh?: () => void;
  t: TFunction;
};

type RepoGroup = {
  commonDir: string;
  repoName: string;
  // Path used to address the repo for /api/git/tasks (any worktree path works).
  // Prefer the main worktree path; fall back to first project's path.
  representativePath: string;
  projects: Project[];
};

function buildGroups(projects: Project[]): { groups: RepoGroup[]; orphans: Project[] } {
  const groupMap = new Map<string, RepoGroup>();
  const orphans: Project[] = [];
  for (const project of projects) {
    const info = project.gitInfo;
    if (!info?.commonDir) {
      orphans.push(project);
      continue;
    }
    const key = info.commonDir;
    let group = groupMap.get(key);
    if (!group) {
      group = {
        commonDir: key,
        repoName: info.repoBasename || 'repo',
        representativePath: info.mainWorktreePath || project.fullPath,
        projects: [],
      };
      groupMap.set(key, group);
    } else if (info.isMainWorktree) {
      // Prefer main worktree path for tasks API calls
      group.representativePath = info.mainWorktreePath || group.representativePath;
    }
    group.projects.push(project);
  }
  // Sort: main first, then alphabetical by branch
  for (const group of groupMap.values()) {
    group.projects.sort((a, b) => {
      const am = a.gitInfo?.isMainWorktree ? 0 : 1;
      const bm = b.gitInfo?.isMainWorktree ? 0 : 1;
      if (am !== bm) return am - bm;
      return (a.gitInfo?.branch || a.displayName).localeCompare(b.gitInfo?.branch || b.displayName);
    });
  }
  return { groups: Array.from(groupMap.values()), orphans };
}

export default function SidebarProjectList({
  projects,
  filteredProjects,
  selectedProject,
  selectedSession,
  isLoading,
  loadingProgress,
  expandedProjects,
  editingProject,
  editingName,
  loadingSessions,
  initialSessionsLoaded,
  currentTime,
  editingSession,
  editingSessionName,
  deletingProjects,
  tasksEnabled,
  mcpServerStatus,
  getProjectSessions,
  isProjectStarred,
  onEditingNameChange,
  onToggleProject,
  onProjectSelect,
  onToggleStarProject,
  onStartEditingProject,
  onCancelEditingProject,
  onSaveProjectName,
  onDeleteProject,
  onSessionSelect,
  onDeleteSession,
  onLoadMoreSessions,
  onNewSession,
  onEditingSessionNameChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  onProjectsRefresh,
  t,
}: SidebarProjectListProps) {
  const [taskModal, setTaskModal] = useState<{ open: boolean; repoPath: string; repoName: string }>({
    open: false,
    repoPath: '',
    repoName: '',
  });

  const state = (
    <SidebarProjectsState
      isLoading={isLoading}
      loadingProgress={loadingProgress}
      projectsCount={projects.length}
      filteredProjectsCount={filteredProjects.length}
      t={t}
    />
  );

  useEffect(() => {
    let baseTitle = 'CloudCLI UI';
    const displayName = selectedProject?.displayName?.trim();
    if (displayName) {
      baseTitle = `${displayName} - ${baseTitle}`;
    }
    document.title = baseTitle;
  }, [selectedProject]);

  const showProjects = !isLoading && projects.length > 0 && filteredProjects.length > 0;

  const { groups, orphans } = useMemo(() => buildGroups(filteredProjects), [filteredProjects]);

  const renderProjectItem = (project: Project, opts: { indent?: boolean; asTask?: boolean } = {}) => {
    // For grouped (task) rendering, override the display name to show the branch
    // and a "main · read-only" marker instead of the repo name (which is the same for every sibling).
    const renderedProject = opts.asTask && project.gitInfo
      ? {
          ...project,
          displayName: project.gitInfo.isMainWorktree
            ? `main · read-only`
            : (project.gitInfo.branch || project.displayName),
        }
      : project;
    return (
    <div key={project.name} className={cn(opts.indent && 'pl-3', opts.asTask && project.gitInfo?.isMainWorktree && 'opacity-70')}>
      <SidebarProjectItem
        project={renderedProject}
        selectedProject={selectedProject}
        selectedSession={selectedSession}
        isExpanded={expandedProjects.has(project.name)}
        isDeleting={deletingProjects.has(project.name)}
        isStarred={isProjectStarred(project.name)}
        editingProject={editingProject}
        editingName={editingName}
        sessions={getProjectSessions(project)}
        initialSessionsLoaded={initialSessionsLoaded.has(project.name)}
        isLoadingSessions={Boolean(loadingSessions[project.name])}
        currentTime={currentTime}
        editingSession={editingSession}
        editingSessionName={editingSessionName}
        tasksEnabled={tasksEnabled}
        mcpServerStatus={mcpServerStatus}
        onEditingNameChange={onEditingNameChange}
        onToggleProject={onToggleProject}
        onProjectSelect={onProjectSelect}
        onToggleStarProject={onToggleStarProject}
        onStartEditingProject={onStartEditingProject}
        onCancelEditingProject={onCancelEditingProject}
        onSaveProjectName={onSaveProjectName}
        onDeleteProject={onDeleteProject}
        onSessionSelect={onSessionSelect}
        onDeleteSession={onDeleteSession}
        onLoadMoreSessions={onLoadMoreSessions}
        onNewSession={onNewSession}
        onEditingSessionNameChange={onEditingSessionNameChange}
        onStartEditingSession={onStartEditingSession}
        onCancelEditingSession={onCancelEditingSession}
        onSaveEditingSession={onSaveEditingSession}
        t={t}
      />
    </div>
  );
  };

  return (
    <div className="pb-safe-area-inset-bottom md:space-y-1">
      {!showProjects ? (
        state
      ) : (
        <>
          {orphans.map((project) => renderProjectItem(project))}
          {groups.map((group) => {
            const taskCount = group.projects.filter((p) => !p.gitInfo?.isMainWorktree).length;
            return (
              <div key={`repo:${group.commonDir}`} className="mt-2 first:mt-0">
                <div className="flex items-center justify-between gap-1 rounded-md px-2 py-1 text-xs uppercase tracking-wide text-muted-foreground">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <Folder className="size-3.5 shrink-0" aria-hidden />
                    <span className="truncate font-semibold">{group.repoName}</span>
                    <span className="ml-1 text-[10px] font-normal normal-case opacity-70">
                      {taskCount === 0 ? 'no tasks' : `${taskCount} task${taskCount === 1 ? '' : 's'}`}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="size-6 p-0"
                    title={`New task in ${group.repoName}`}
                    onClick={() => setTaskModal({ open: true, repoPath: group.representativePath, repoName: group.repoName })}
                  >
                    <Plus className="size-3.5" aria-hidden />
                  </Button>
                </div>
                <div className="space-y-1">
                  {group.projects.map((project) => renderProjectItem(project, { indent: true, asTask: true }))}
                </div>
              </div>
            );
          })}
        </>
      )}

      <NewTaskModal
        open={taskModal.open}
        onOpenChange={(open) => setTaskModal((prev) => ({ ...prev, open }))}
        repoPath={taskModal.repoPath}
        repoName={taskModal.repoName}
        onTaskCreated={() => {
          onProjectsRefresh?.();
        }}
      />
    </div>
  );
}
