export function ProjectSidebar({
  projects,
  selectedProjectId,
  onSelectProject,
  workspaceView,
  onWorkspaceViewChange,
  collapsed,
  onToggleCollapse,
}) {
  return (
    <aside className={`sidebar ${collapsed ? "is-collapsed" : ""}`}>
      <div className="sidebar__header">
        <div className="sidebar__intro">
          <p className="eyebrow">Workspace</p>
          {collapsed ? <span className="sidebar__monogram">LK</span> : null}
          <h1>{collapsed ? "Local" : "Local Kanban"}</h1>
          {!collapsed ? (
            <p className="muted">
              Tableros locales por proyecto, con historias y épicas leídas desde Markdown.
            </p>
          ) : null}
        </div>

        <button
          className={`sidebar-collapse-button ${collapsed ? "is-collapsed" : ""}`}
          type="button"
          onClick={onToggleCollapse}
          aria-label={collapsed ? "Expandir navegación" : "Contraer navegación"}
          title={collapsed ? "Expandir navegación" : "Contraer navegación"}
        >
          <span className="sidebar-collapse-button__icon">{collapsed ? "→" : "←"}</span>
          {!collapsed ? <span>Contraer</span> : null}
        </button>
      </div>

      <div className="sidebar__section">
        {!collapsed ? <p className="eyebrow">Vista</p> : null}
        <div className={`view-switcher ${collapsed ? "is-collapsed" : ""}`} data-testid="workspace-view-switcher">
          <button
            className={`view-switcher__button ${workspaceView === "kanban" ? "is-active" : ""}`}
            type="button"
            onClick={() => onWorkspaceViewChange("kanban")}
            title="Vista kanban"
            aria-label="Vista kanban"
            data-testid="workspace-view-kanban"
          >
            <span className="view-switcher__icon">K</span>
            {!collapsed ? <span>Kanban</span> : null}
          </button>
          <button
            className={`view-switcher__button ${workspaceView === "graph" ? "is-active" : ""}`}
            type="button"
            onClick={() => onWorkspaceViewChange("graph")}
            title="Vista grafo"
            aria-label="Vista grafo"
            data-testid="workspace-view-graph"
          >
            <span className="view-switcher__icon">G</span>
            {!collapsed ? <span>Grafo</span> : null}
          </button>
        </div>
      </div>

      {!collapsed ? (
        <div className="project-list">
          {projects.map((project) => {
            const isActive = project.id === selectedProjectId;
            const totalStories = project.stories.length;

            return (
              <button
                key={project.id}
                className={`project-list__item ${isActive ? "is-active" : ""}`}
                onClick={() => onSelectProject(project.id)}
                type="button"
              >
                <span className="project-list__name">{project.name}</span>
                <span className="project-list__meta">Tablero local conectado a Markdown</span>
                <span className="project-list__stats" aria-hidden="true">
                  <span className="project-list__stat">
                    <strong>{totalStories}</strong>
                    <small>Historias</small>
                  </span>
                  <span className="project-list__stat">
                    <strong>{project.epics.length}</strong>
                    <small>Épicas</small>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </aside>
  );
}
