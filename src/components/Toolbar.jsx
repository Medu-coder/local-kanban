export function Toolbar({
  project,
  searchQuery,
  onSearchQueryChange,
  epicFilter,
  onEpicFilterChange,
  executionModeFilter,
  onExecutionModeFilterChange,
  onCreateStory,
  onManageEpics,
  visibleCount,
  showCollapseAll,
  canCollapseAll,
  onCollapseAll,
  supplementalControls,
}) {
  return (
    <section className="toolbar" data-testid="toolbar">
      <div className="toolbar__layout">
        <div className="toolbar__row">
          <label className="field">
            <span>Buscar</span>
            <input
              data-testid="search-input"
              placeholder="Título, ID, descripción o texto…"
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.target.value)}
            />
          </label>

          <label className="field">
            <span>Épica</span>
            <select
              data-testid="epic-filter"
              value={epicFilter}
              onChange={(event) => onEpicFilterChange(event.target.value)}
            >
              <option value="all">Todas</option>
              <option value="__no_epic__">Sin épica</option>
              {project.epics.map((epic) => (
                <option key={epic.id} value={epic.id}>
                  {epic.title}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Modo</span>
            <select
              data-testid="execution-mode-filter"
              value={executionModeFilter}
              onChange={(event) => onExecutionModeFilterChange(event.target.value)}
            >
              <option value="all">Todos</option>
              <option value="human">Human</option>
              <option value="agent">Agent</option>
              <option value="hybrid">Hybrid</option>
            </select>
          </label>

          <button
            className="primary-button toolbar__button"
            type="button"
            onClick={onCreateStory}
            data-sidepanel-action="true"
            data-testid="create-story-button"
          >
            Nueva historia
          </button>

          <button
            className="ghost-button toolbar__button"
            type="button"
            onClick={onManageEpics}
            data-sidepanel-action="true"
            data-testid="manage-epics-button"
          >
            Gestionar épicas
          </button>
        </div>

        <div className="toolbar__footer">
          <div className="toolbar__summary">
            <span className="count-pill">{visibleCount}</span>
            <div className="toolbar__summary-copy">
              <strong>Historias visibles</strong>
              <p className="muted">Filtra por búsqueda y por épica activa.</p>
            </div>
            {showCollapseAll ? (
              <button
                className="ghost-button toolbar__summary-action"
                type="button"
                data-sidepanel-action="true"
                data-testid="collapse-all-lanes-button"
                onClick={onCollapseAll}
                disabled={!canCollapseAll}
              >
                Contraer todo
              </button>
            ) : null}
          </div>

          {supplementalControls ? <div className="toolbar__supplemental">{supplementalControls}</div> : null}
        </div>
      </div>
    </section>
  );
}
