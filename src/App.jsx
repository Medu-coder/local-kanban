import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  createEpic,
  createStory,
  fetchProjects,
  moveStory,
  saveEpic,
  saveStory,
  toggleStoryCriterion,
  toggleStorySubtask,
} from "./lib/api";
import { ProjectSidebar } from "./components/ProjectSidebar";
import { KanbanBoard } from "./components/KanbanBoard";
import { StoryGraphView } from "./components/StoryGraphView";
import { StoryDetail } from "./components/StoryDetail";
import { StoryEditor } from "./components/StoryEditor";
import { Toolbar } from "./components/Toolbar";
import { deriveEpicId, deriveStoryId } from "./lib/story";
import { EpicEditor } from "./components/EpicEditor";
import { EpicManager } from "./components/EpicManager";
import { EpicDetail } from "./components/EpicDetail";

const setupSteps = [
  "Añade tus proyectos en config/projects.json con rootPath y docsPath.",
  "En cada proyecto crea AGENTS.md en la raiz importando la skill normativa de Local Kanban.",
  "En cada proyecto crea docs/kanban/epics y docs/kanban/stories.",
  "Usa la plantilla de docs/PROJECT_KANBAN_SETUP.md para que otro agente deje el repo preparado.",
];
const DENSITY_STORAGE_KEY = "local-kanban.ui-density";
const DEFAULT_DENSITY = "dense";

function loadInitialDensity() {
  if (typeof window === "undefined") {
    return DEFAULT_DENSITY;
  }

  const savedDensity = window.localStorage.getItem(DENSITY_STORAGE_KEY);
  if (savedDensity === "comfortable" || savedDensity === "compact" || savedDensity === "dense") {
    return savedDensity;
  }

  return DEFAULT_DENSITY;
}

function getCollapsibleLaneIds(project) {
  if (!project) {
    return [];
  }

  const epicLaneIds = project.epics
    .filter((epic) => (epic.storyCount ?? 0) > 0)
    .map((epic) => epic.id);
  const hasNoEpicStories = project.stories.some((story) => !story.epicId);

  return hasNoEpicStories ? [...epicLaneIds, "__no_epic__"] : epicLaneIds;
}

export default function App() {
  const MIN_LEFT_WIDTH = 220;
  const MAX_LEFT_WIDTH = 420;
  const MIN_RIGHT_WIDTH = 320;
  const MAX_RIGHT_WIDTH = 720;
  const [data, setData] = useState({ projects: [], statuses: [] });
  const [workspaceView, setWorkspaceView] = useState("kanban");
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [selectedStory, setSelectedStory] = useState(null);
  const [selectedEpic, setSelectedEpic] = useState(null);
  const [draggedStory, setDraggedStory] = useState(null);
  const [editorStory, setEditorStory] = useState(null);
  const [editorEpic, setEditorEpic] = useState(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isSavingStory, setIsSavingStory] = useState(false);
  const [isSavingEpic, setIsSavingEpic] = useState(false);
  const [isEditorDirty, setIsEditorDirty] = useState(false);
  const [isUpdatingSubtask, setIsUpdatingSubtask] = useState(false);
  const [isUpdatingCriterion, setIsUpdatingCriterion] = useState(false);
  const [sidePanelMode, setSidePanelMode] = useState("detail");
  const [searchQuery, setSearchQuery] = useState("");
  const [epicFilter, setEpicFilter] = useState("all");
  const [executionModeFilter, setExecutionModeFilter] = useState("all");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [storyDraft, setStoryDraft] = useState(null);
  const [collapsedLanes, setCollapsedLanes] = useState({});
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(300);
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(false);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(420);
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(false);
  const [density, setDensity] = useState(loadInitialDensity);
  const storyEditorSubmitRef = useRef(null);
  const epicEditorSubmitRef = useRef(null);
  const pendingEditorActionRef = useRef(null);
  const refreshPromiseRef = useRef(null);
  const refreshQueuedRef = useRef(false);

  useEffect(() => {
    window.localStorage.setItem(DENSITY_STORAGE_KEY, density);
  }, [density]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError("");

      try {
        const payload = await fetchProjects();
        if (cancelled) {
          return;
        }

        setData(payload);
        setSelectedProjectId((current) => current ?? payload.projects[0]?.id ?? null);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError.message);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedProject =
    data.projects.find((project) => project.id === selectedProjectId) ?? data.projects[0] ?? null;
  const liveSelectedStory =
    selectedStory && selectedProject
      ? selectedProject.stories.find((story) => story.id === selectedStory.id) ?? selectedStory
      : null;
  const liveSelectedEpic =
    selectedEpic && selectedProject
      ? selectedProject.epics.find((epic) => epic.id === selectedEpic.id) ?? selectedEpic
      : null;

  const visibleProject = useMemo(() => {
    if (!selectedProject) {
      return null;
    }

    const normalizedQuery = searchQuery.trim().toLowerCase();
    const stories = selectedProject.stories.filter((story) => {
      const matchesEpic =
        epicFilter === "all" ||
        (epicFilter === "__no_epic__" ? !story.epicId : story.epicId === epicFilter);

      if (!matchesEpic) {
        return false;
      }

      const matchesExecutionMode =
        executionModeFilter === "all" || story.executionMode === executionModeFilter;

      if (!matchesExecutionMode) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      const haystack = [
        story.id,
        story.title,
        story.description,
        story.body,
        story.epicTitle,
        story.assignee,
        story.agentOwner,
        story.agentStatusNote,
        story.storyType,
        ...(story.labels ?? []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedQuery);
    });

    const stats = {
      backlog: stories.filter((story) => story.status === "backlog").length,
      developing: stories.filter((story) => story.status === "developing").length,
      testing: stories.filter((story) => story.status === "testing").length,
      done: stories.filter((story) => story.status === "done").length,
    };

    return { ...selectedProject, stories, stats };
  }, [selectedProject, searchQuery, epicFilter, executionModeFilter]);

  useEffect(() => {
    if (!visibleProject) {
      return;
    }

    setCollapsedLanes((current) => {
      const next = { ...current };

      for (const epic of visibleProject.epics) {
        if (next[epic.id] === undefined && (epic.storyCount ?? 0) === 0) {
          next[epic.id] = true;
        }
      }

      const noEpicCount = visibleProject.stories.filter((story) => !story.epicId).length;
      if (next.__no_epic__ === undefined && noEpicCount === 0) {
        next.__no_epic__ = true;
      }

      return next;
    });
  }, [visibleProject]);

  async function refreshProjects(options = {}) {
    const { suppressError = false } = options;

    if (refreshPromiseRef.current) {
      refreshQueuedRef.current = true;
      return refreshPromiseRef.current;
    }

    const runRefresh = async () => {
      do {
        refreshQueuedRef.current = false;
        const payload = await fetchProjects();
        startTransition(() => {
          setData(payload);
        });
      } while (refreshQueuedRef.current);
    };

    const promise = runRefresh()
      .catch((refreshError) => {
        if (suppressError) {
          setError(refreshError.message);
          return;
        }

        throw refreshError;
      })
      .finally(() => {
        if (refreshPromiseRef.current === promise) {
          refreshPromiseRef.current = null;
        }
      });

    refreshPromiseRef.current = promise;
    return promise;
  }

  useEffect(() => {
    const events = new EventSource("/api/events");

    events.onmessage = (event) => {
      if (event.data !== "refresh") {
        return;
      }

      void refreshProjects({ suppressError: true });
    };

    return () => {
      events.close();
    };
  }, []);

  async function handleSaveStory(payload) {
    if (!selectedProject) {
      return;
    }

    setIsSavingStory(true);
    setError("");

    try {
      if (editorStory) {
        await saveStory(selectedProject.id, editorStory.id, payload);
      } else {
        const nextId = deriveStoryId(payload);
        const storyExists = selectedProject.stories.some((story) => story.id === nextId);

        if (storyExists) {
          throw new Error(`Ya existe una historia con el ID ${nextId}. Usa otro ID o cambia el titulo.`);
        }

        await createStory(selectedProject.id, payload);
      }

      await refreshProjects();
      if (!editorStory) {
        const createdEpicId = payload.epicId ?? null;
        const createdLaneId = createdEpicId ?? "__no_epic__";
        const normalizedFilterEpicId = epicFilter === "__no_epic__" ? null : epicFilter;
        const filterExcludesCreatedStory =
          epicFilter !== "all" && normalizedFilterEpicId !== createdEpicId;

        setCollapsedLanes((current) => ({
          ...current,
          [createdLaneId]: false,
        }));

        if (filterExcludesCreatedStory) {
          setEpicFilter(createdEpicId ?? "__no_epic__");
        }
      }
      resetEditorState();
      runPendingEditorAction();
    } catch (saveError) {
      setError(saveError.message);
      pendingEditorActionRef.current = null;
    } finally {
      setIsSavingStory(false);
    }
  }

  async function handleSaveEpic(payload) {
    if (!selectedProject) {
      return;
    }

    setIsSavingEpic(true);
    setError("");

    try {
      if (editorEpic) {
        await saveEpic(selectedProject.id, editorEpic.id, payload);
      } else {
        const nextId = deriveEpicId(payload);
        const epicExists = selectedProject.epics.some((epic) => epic.id === nextId);

        if (epicExists) {
          throw new Error(`Ya existe una épica con el ID ${nextId}. Usa otro ID o cambia el título.`);
        }

        await createEpic(selectedProject.id, payload);
      }

      await refreshProjects();
      setSelectedStory(null);
      setSelectedEpic(null);
      setEditorStory(null);
      setEditorEpic(null);
      setStoryDraft(null);
      setIsEditorOpen(false);
      setIsEditorDirty(false);
      setSidePanelMode("epic-manager");
      setRightSidebarCollapsed(false);
      runPendingEditorAction();
    } catch (saveError) {
      setError(saveError.message);
      pendingEditorActionRef.current = null;
    } finally {
      setIsSavingEpic(false);
    }
  }

  function registerStoryEditorSubmit(submitHandler) {
    storyEditorSubmitRef.current = submitHandler;
  }

  function registerEpicEditorSubmit(submitHandler) {
    epicEditorSubmitRef.current = submitHandler;
  }

  function resetEditorState() {
    setSelectedStory(null);
    setSelectedEpic(null);
    setEditorStory(null);
    setEditorEpic(null);
    setStoryDraft(null);
    setIsEditorOpen(false);
    setIsEditorDirty(false);
    setSidePanelMode("detail");
  }

  function runPendingEditorAction() {
    const action = pendingEditorActionRef.current;
    pendingEditorActionRef.current = null;
    action?.();
  }

  function requestEditorTransition(nextAction) {
    if (!isEditorOpen || !isEditorDirty) {
      nextAction();
      return;
    }

    const shouldSave = window.confirm(
      "Hay cambios sin guardar. ¿Quieres guardarlos antes de continuar?"
    );

    if (shouldSave) {
      pendingEditorActionRef.current = nextAction;
      const submitHandler =
        sidePanelMode === "story-editor"
          ? storyEditorSubmitRef.current
          : sidePanelMode === "epic-editor"
            ? epicEditorSubmitRef.current
            : null;

      submitHandler?.();
      return;
    }

    if (!window.confirm("Si sales ahora perderás los cambios. ¿Quieres descartarlos?")) {
      return;
    }

    pendingEditorActionRef.current = null;
    nextAction();
  }

  useEffect(() => {
    if (!isEditorOpen || !isEditorDirty) {
      return undefined;
    }

    function handleBeforeUnload(event) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [isEditorDirty, isEditorOpen]);

  async function handleDropStory(nextStatus, nextEpicId) {
    const normalizedEpicId = nextEpicId === "__no_epic__" ? null : nextEpicId;

    if (
      !draggedStory ||
      (draggedStory.status === nextStatus && (draggedStory.epicId ?? null) === normalizedEpicId)
    ) {
      setDraggedStory(null);
      return;
    }

    setError("");

    const nextEpicTitle = normalizedEpicId
      ? selectedProject?.epics.find((epic) => epic.id === normalizedEpicId)?.title ?? normalizedEpicId
      : "Sin épica";

    setData((current) => ({
      ...current,
      projects: current.projects.map((project) => {
        if (project.id !== draggedStory.projectId) {
          return project;
        }

        const stories = project.stories.map((story) =>
          story.id === draggedStory.id
            ? {
                ...story,
                status: nextStatus,
                epicId: normalizedEpicId,
                epicTitle: nextEpicTitle,
              }
            : story
        );

        const stats = {
          backlog: stories.filter((story) => story.status === "backlog").length,
          developing: stories.filter((story) => story.status === "developing").length,
          testing: stories.filter((story) => story.status === "testing").length,
          done: stories.filter((story) => story.status === "done").length,
        };

        return { ...project, stories, stats };
      }),
    }));

    try {
      await moveStory(draggedStory.projectId, draggedStory.id, {
        status: nextStatus,
        epicId: normalizedEpicId,
      });
      await refreshProjects();
      setSelectedStory((current) =>
        current?.id === draggedStory.id
          ? { ...current, status: nextStatus, epicId: normalizedEpicId, epicTitle: nextEpicTitle }
          : current
      );
    } catch (updateError) {
      setError(updateError.message);
      await refreshProjects();
    } finally {
      setDraggedStory(null);
    }
  }

  async function handleToggleSubtask(subtaskIndex) {
    if (!liveSelectedStory) {
      return;
    }

    const previousStory = liveSelectedStory;
    const nextSubtasks = liveSelectedStory.subtasks.map((subtask, index) => {
      if (index !== subtaskIndex || typeof subtask === "string") {
        return subtask;
      }

      return {
        ...subtask,
        done: !subtask.done,
      };
    });

    setIsUpdatingSubtask(true);
    setError("");
    setSelectedStory((current) =>
      current ? { ...current, subtasks: nextSubtasks } : current
    );

    try {
      const result = await toggleStorySubtask(
        liveSelectedStory.projectId,
        liveSelectedStory.id,
        subtaskIndex
      );
      const syncedSubtasks = result.subtasks ?? nextSubtasks;

      setSelectedStory((current) =>
        current ? { ...current, subtasks: syncedSubtasks } : current
      );
      await refreshProjects();
    } catch (updateError) {
      setError(updateError.message);
      setSelectedStory(previousStory);
    } finally {
      setIsUpdatingSubtask(false);
    }
  }

  async function handleToggleCriterion(criteriaType, criterionIndex) {
    if (!liveSelectedStory) {
      return;
    }

    const criteriaField = criteriaType === "ready" ? "readyCriteria" : "doneCriteria";
    const progressField = criteriaType === "ready" ? "readyCriteriaProgress" : "doneCriteriaProgress";
    const previousStory = liveSelectedStory;
    const nextCriteria = liveSelectedStory[criteriaField].map((criterion, index) =>
      index === criterionIndex && criterion.editable
        ? { ...criterion, checked: !criterion.checked }
        : criterion
    );
    const nextProgress = {
      total: nextCriteria.length,
      completed: nextCriteria.filter((criterion) => criterion.checked).length,
    };
    nextProgress.isComplete =
      criteriaType === "done"
        ? nextProgress.total > 0 && nextProgress.completed === nextProgress.total
        : nextProgress.completed === nextProgress.total;

    setIsUpdatingCriterion(true);
    setError("");
    setSelectedStory((current) =>
      current
        ? {
            ...current,
            [criteriaField]: nextCriteria,
            [progressField]: nextProgress,
            ...(criteriaType === "ready"
              ? { isReadyForDeveloping: !current.isBlocked && nextProgress.isComplete }
              : { isDoneValidated: nextProgress.isComplete }),
          }
        : current
    );

    try {
      await toggleStoryCriterion(liveSelectedStory.projectId, liveSelectedStory.id, criteriaType, criterionIndex);
      await refreshProjects();
    } catch (updateError) {
      setError(updateError.message);
      setSelectedStory(previousStory);
    } finally {
      setIsUpdatingCriterion(false);
    }
  }

  function closeSidePanel() {
    requestEditorTransition(() => {
      resetEditorState();
    });
  }

  function handleMainAreaClick(event) {
    if (event.target.closest("[data-sidepanel-action='true']")) {
      return;
    }

    closeSidePanel();
  }

  function startResize(side) {
    return (event) => {
      event.preventDefault();
      const startX = event.clientX;
      const startLeftWidth = leftSidebarWidth;
      const startRightWidth = rightSidebarWidth;

      function onPointerMove(moveEvent) {
        if (side === "left") {
          const nextWidth = Math.min(
            MAX_LEFT_WIDTH,
            Math.max(MIN_LEFT_WIDTH, startLeftWidth + (moveEvent.clientX - startX))
          );
          setLeftSidebarWidth(nextWidth);
        }

        if (side === "right") {
          const nextWidth = Math.min(
            MAX_RIGHT_WIDTH,
            Math.max(MIN_RIGHT_WIDTH, startRightWidth - (moveEvent.clientX - startX))
          );
          setRightSidebarWidth(nextWidth);
        }
      }

      function onPointerUp() {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
      }

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    };
  }

  const hasRightPanel =
    (isEditorOpen && selectedProject) ||
    sidePanelMode === "epic-manager" ||
    sidePanelMode === "epic-detail" ||
    Boolean(liveSelectedStory);
  const collapsibleLaneIds = getCollapsibleLaneIds(visibleProject);
  const canCollapseAllVisibleLanes =
    workspaceView === "kanban" && collapsibleLaneIds.some((laneId) => !collapsedLanes[laneId]);

  return (
    <div
      className={`app-shell density-${density}`}
      style={{
        "--left-sidebar-width": `${leftSidebarCollapsed ? 88 : leftSidebarWidth}px`,
      }}
    >
      <div className="left-sidebar-shell">
        <ProjectSidebar
          projects={data.projects}
          selectedProjectId={selectedProjectId}
          workspaceView={workspaceView}
          collapsed={leftSidebarCollapsed}
          onToggleCollapse={() => setLeftSidebarCollapsed((current) => !current)}
          onWorkspaceViewChange={setWorkspaceView}
          onSelectProject={(projectId) => {
            requestEditorTransition(() => {
              setSelectedProjectId(projectId);
              resetEditorState();
            });
          }}
        />
        {!leftSidebarCollapsed ? (
          <div className="resize-handle resize-handle--left" onPointerDown={startResize("left")} />
        ) : null}
      </div>

      <main className="main-panel" onClick={handleMainAreaClick}>
        <div className="workspace-canvas">
          <section className="topbar">
            <div className="topbar__headline">
              <div className="topbar__headline-meta">
                <p className="eyebrow">Proyecto activo</p>
                <label className="topbar__density-control">
                  <span>Densidad</span>
                  <select
                    data-testid="density-select"
                    value={density}
                    onChange={(event) => setDensity(event.target.value)}
                  >
                    <option value="comfortable">Cómoda</option>
                    <option value="compact">Compacta</option>
                    <option value="dense">Densa</option>
                  </select>
                </label>
              </div>
              <h2 data-testid="current-project-name">{selectedProject?.name ?? "Sin proyectos configurados"}</h2>
              <p className="topbar__path muted">
                <span>Origen</span>
                <code translate="no">
                  {selectedProject
                    ? `${selectedProject.rootPath}/${selectedProject.docsPath}`
                    : "Configura tus rutas locales para empezar."}
                </code>
              </p>
            </div>

            <div className="topbar__stats-row" aria-label="Resumen del proyecto activo">
              {selectedProject ? (
                <>
                  <div className="topbar__metric">
                    <strong>{selectedProject.stories.length}</strong>
                    <span>Historias</span>
                  </div>
                  <div className="topbar__metric">
                    <strong>{selectedProject.epics.length}</strong>
                    <span>Épicas</span>
                  </div>
                  <div className="topbar__metric">
                    <strong>{visibleProject?.stories.length ?? 0}</strong>
                    <span>Visibles</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="topbar__metric">
                    <strong>0</strong>
                    <span>Historias</span>
                  </div>
                  <div className="topbar__metric">
                    <strong>0</strong>
                    <span>Épicas</span>
                  </div>
                  <div className="topbar__metric">
                    <strong>0</strong>
                    <span>Visibles</span>
                  </div>
                </>
              )}
              <div className="topbar__metric topbar__metric--status">
                <span className={`sync-indicator ${isPending ? "is-busy" : ""}`} />
                <div>
                  <strong>{isLoading ? "Cargando…" : isPending ? "Sincronizando…" : "Sincronizado"}</strong>
                  <span>Estado local</span>
                </div>
              </div>
            </div>
          </section>

          {error ? <div className="error-banner">{error}</div> : null}

          {selectedProject ? (
            <Toolbar
              project={selectedProject}
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
              epicFilter={epicFilter}
              onEpicFilterChange={setEpicFilter}
              executionModeFilter={executionModeFilter}
              onExecutionModeFilterChange={setExecutionModeFilter}
              onCreateStory={() => {
                requestEditorTransition(() => {
                  setEditorStory(null);
                  setEditorEpic(null);
                  setStoryDraft(null);
                  setSelectedStory(null);
                  setSelectedEpic(null);
                  setIsEditorOpen(true);
                  setIsEditorDirty(false);
                  setSidePanelMode("story-editor");
                  setRightSidebarCollapsed(false);
                });
              }}
              onManageEpics={() => {
                requestEditorTransition(() => {
                  setSelectedStory(null);
                  setSelectedEpic(null);
                  setEditorStory(null);
                  setEditorEpic(null);
                  setStoryDraft(null);
                  setIsEditorOpen(false);
                  setIsEditorDirty(false);
                  setSidePanelMode("epic-manager");
                  setRightSidebarCollapsed(false);
                });
              }}
              visibleCount={visibleProject?.stories.length ?? 0}
              showCollapseAll={workspaceView === "kanban"}
              canCollapseAll={canCollapseAllVisibleLanes}
              onCollapseAll={() => {
                setCollapsedLanes((current) => {
                  const next = { ...current };
                  for (const laneId of collapsibleLaneIds) {
                    next[laneId] = true;
                  }
                  return next;
                });
              }}
              supplementalControls={
                workspaceView === "graph" ? (
                  <div className="toolbar__mode-pill" data-testid="toolbar-graph-mode">
                    <span className="toolbar__mode-dot" />
                    <div>
                      <strong>Vista grafo</strong>
                      <p className="muted">Explora dependencias, avance y densidad de trabajo.</p>
                    </div>
                  </div>
                ) : null
              }
            />
          ) : null}

          {!selectedProject && !isLoading ? (
            <section className="setup-panel">
              <h3>Primer arranque</h3>
              <p>
                La app está lista, pero todavía no tiene proyectos válidos. Empieza por editar
                <code> config/projects.json</code> y añade las rutas locales que quieras monitorizar.
              </p>
              <ul>
                {setupSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {visibleProject
            ? workspaceView === "graph"
              ? (
                <StoryGraphView
                  project={visibleProject}
                  density={density}
                  onSelectStory={(story) => {
                    requestEditorTransition(() => {
                      setSelectedEpic(null);
                      setSelectedStory(story);
                      setEditorStory(null);
                      setEditorEpic(null);
                      setStoryDraft(null);
                      setIsEditorOpen(false);
                      setIsEditorDirty(false);
                      setSidePanelMode("detail");
                      setRightSidebarCollapsed(false);
                    });
                  }}
                  onSelectEpic={(epicId) => {
                    requestEditorTransition(() => {
                      const epic = selectedProject?.epics.find((item) => item.id === epicId) ?? null;
                      setSelectedStory(null);
                      setSelectedEpic(epic);
                      setEditorStory(null);
                      setEditorEpic(null);
                      setStoryDraft(null);
                      setIsEditorOpen(false);
                      setIsEditorDirty(false);
                      setSidePanelMode("epic-detail");
                      setRightSidebarCollapsed(false);
                    });
                  }}
                  onBackgroundClick={closeSidePanel}
                />
              )
              : (
                <KanbanBoard
                  project={visibleProject}
                  epicFilter={epicFilter}
                  onSelectStory={(story) => {
                    requestEditorTransition(() => {
                      setSelectedEpic(null);
                      setSelectedStory(story);
                      setRightSidebarCollapsed(false);
                    });
                  }}
                  onDropStory={handleDropStory}
                  draggedStory={draggedStory}
                  onDragStart={setDraggedStory}
                  onDragEnd={() => setDraggedStory(null)}
                  onBackgroundClick={closeSidePanel}
                  onSelectEpic={(epicId) => {
                    requestEditorTransition(() => {
                      const epic = selectedProject?.epics.find((item) => item.id === epicId) ?? null;
                      setSelectedStory(null);
                      setSelectedEpic(epic);
                      setEditorStory(null);
                      setEditorEpic(null);
                      setStoryDraft(null);
                      setIsEditorOpen(false);
                      setIsEditorDirty(false);
                      setSidePanelMode("epic-detail");
                      setRightSidebarCollapsed(false);
                    });
                  }}
                  onQuickCreateStory={(epicId, status) => {
                    requestEditorTransition(() => {
                      setSelectedStory(null);
                      setSelectedEpic(null);
                      setEditorStory(null);
                      setEditorEpic(null);
                      setStoryDraft({
                        epicId: epicId === "__no_epic__" ? "" : epicId,
                        status,
                      });
                      setIsEditorOpen(true);
                      setIsEditorDirty(false);
                      setSidePanelMode("story-editor");
                      setRightSidebarCollapsed(false);
                    });
                  }}
                  collapsedLanes={collapsedLanes}
                  onToggleLane={(laneId) => {
                    setCollapsedLanes((current) => ({
                      ...current,
                      [laneId]: !current[laneId],
                    }));
                  }}
                />
              )
            : null}
        </div>
      </main>

      {hasRightPanel ? (
        <div
          className={`right-sidebar-shell ${rightSidebarCollapsed ? "is-collapsed" : ""}`}
          style={{ "--right-sidebar-width": `${rightSidebarWidth}px` }}
        >
          {!rightSidebarCollapsed ? (
            <>
              <div className="resize-handle resize-handle--right" onPointerDown={startResize("right")} />
              <button
                className="sidebar-toggle sidebar-toggle--right"
                type="button"
                onClick={() => setRightSidebarCollapsed(true)}
                aria-label="Contraer panel lateral"
                title="Contraer panel lateral"
              >
                <span className="sidebar-toggle__icon">→</span>
                <span>Contraer</span>
              </button>
              {isEditorOpen && sidePanelMode === "story-editor" && selectedProject ? (
                <StoryEditor
                  project={selectedProject}
                  story={editorStory}
                  draft={storyDraft}
                  onClose={() => {
                    closeSidePanel();
                  }}
                  onSubmit={handleSaveStory}
                  isSaving={isSavingStory}
                  onDirtyChange={setIsEditorDirty}
                  onRegisterSubmit={registerStoryEditorSubmit}
                />
              ) : isEditorOpen && sidePanelMode === "epic-editor" && selectedProject ? (
                <EpicEditor
                  project={selectedProject}
                  epic={editorEpic}
                  onClose={() => {
                    requestEditorTransition(() => {
                      setIsEditorOpen(false);
                      setEditorEpic(null);
                      setIsEditorDirty(false);
                      setSidePanelMode("epic-manager");
                    });
                  }}
                  onSubmit={handleSaveEpic}
                  isSaving={isSavingEpic}
                  onDirtyChange={setIsEditorDirty}
                  onRegisterSubmit={registerEpicEditorSubmit}
                />
              ) : sidePanelMode === "epic-manager" && selectedProject ? (
                <EpicManager
                  project={selectedProject}
                  onCreateEpic={() => {
                    setEditorEpic(null);
                    setEditorStory(null);
                    setSelectedStory(null);
                    setSelectedEpic(null);
                    setIsEditorOpen(true);
                    setIsEditorDirty(false);
                    setSidePanelMode("epic-editor");
                  }}
                  onEditEpic={(epic) => {
                    setEditorEpic(epic);
                    setEditorStory(null);
                    setSelectedStory(null);
                    setSelectedEpic(null);
                    setIsEditorOpen(true);
                    setIsEditorDirty(false);
                    setSidePanelMode("epic-editor");
                  }}
                  onClose={() => {
                    closeSidePanel();
                  }}
                />
              ) : sidePanelMode === "epic-detail" && liveSelectedEpic && selectedProject ? (
                <EpicDetail
                  epic={liveSelectedEpic}
                  stories={selectedProject.stories.filter((story) => story.epicId === liveSelectedEpic.id)}
                  onClose={closeSidePanel}
                  onEdit={(epic) => {
                    setSelectedEpic(null);
                    setEditorEpic(epic);
                    setIsEditorOpen(true);
                    setIsEditorDirty(false);
                    setSidePanelMode("epic-editor");
                  }}
                  onCreateStory={(epicId, status) => {
                    setSelectedEpic(null);
                    setStoryDraft({ epicId, status });
                    setEditorStory(null);
                    setIsEditorOpen(true);
                    setIsEditorDirty(false);
                    setSidePanelMode("story-editor");
                  }}
                />
              ) : (
                <StoryDetail
                  story={liveSelectedStory}
                  onClose={closeSidePanel}
                  onEdit={(story) => {
                    setSelectedEpic(null);
                    setSelectedStory(null);
                    setEditorStory(story);
                    setEditorEpic(null);
                    setStoryDraft(null);
                    setIsEditorOpen(true);
                    setSidePanelMode("story-editor");
                  }}
                  onToggleSubtask={handleToggleSubtask}
                  onToggleCriterion={handleToggleCriterion}
                  isUpdatingSubtask={isUpdatingSubtask}
                  isUpdatingCriterion={isUpdatingCriterion}
                />
              )}
            </>
          ) : (
              <button
                className="sidebar-toggle sidebar-toggle--collapsed"
                type="button"
                onClick={() => setRightSidebarCollapsed(false)}
                aria-label="Expandir panel lateral"
                title="Expandir panel lateral"
              >
              <span className="sidebar-toggle__icon">←</span>
              <span className="sidebar-toggle__body">
                <strong>Panel</strong>
                <small>Expandir</small>
              </span>
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
