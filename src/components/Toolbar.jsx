export function Toolbar({
  project,
  searchQuery,
  onSearchQueryChange,
  epicFilter,
  onEpicFilterChange,
  onCreateStory,
  onManageEpics,
  visibleCount,
}) {
  return (
    <section className="toolbar" data-testid="toolbar">
      <div className="toolbar__filters">
        <label className="field">
          <span>Buscar</span>
          <input
            data-testid="search-input"
            placeholder="Titulo, ID, descripcion o texto"
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
          />
        </label>

        <label className="field">
          <span>Epica</span>
          <select
            data-testid="epic-filter"
            value={epicFilter}
            onChange={(event) => onEpicFilterChange(event.target.value)}
          >
            <option value="all">Todas</option>
            <option value="__no_epic__">Sin epica</option>
            {project.epics.map((epic) => (
              <option key={epic.id} value={epic.id}>
                {epic.title}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="toolbar__actions">
        <div className="toolbar__summary">
          <span className="count-pill">{visibleCount}</span>
          <span className="muted">historias visibles</span>
        </div>

        <button
          className="primary-button"
          type="button"
          onClick={onCreateStory}
          data-sidepanel-action="true"
          data-testid="create-story-button"
        >
          Nueva historia
        </button>

        <button
          className="ghost-button"
          type="button"
          onClick={onManageEpics}
          data-sidepanel-action="true"
          data-testid="manage-epics-button"
        >
          Gestionar épicas
        </button>
      </div>
    </section>
  );
}
