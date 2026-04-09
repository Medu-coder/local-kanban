export function EpicManager({ project, onCreateEpic, onEditEpic, onClose }) {
  return (
    <aside className="detail-panel" onClick={(event) => event.stopPropagation()} data-testid="epic-manager-panel">
      <div className="detail-panel__header">
        <div>
          <p className="eyebrow">Épicas</p>
          <h2>{project.name}</h2>
        </div>
        <div className="panel-actions">
          <button className="primary-button" type="button" onClick={onCreateEpic} data-testid="create-epic-button">
            Nueva épica
          </button>
          <button className="ghost-button" type="button" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>

      <section className="epic-manager-list">
        {project.epics.length ? (
          project.epics.map((epic) => (
            <article key={epic.id} className="epic-manager-card">
              <div className="epic-manager-card__header">
                <div>
                  <p className="eyebrow">Epic</p>
                  <h3>{epic.title}</h3>
                </div>
                <span className="count-pill">{epic.storyCount ?? 0}</span>
              </div>
              <p className="muted">{epic.description || "Sin descripcion breve."}</p>
              <div className="epic-manager-card__footer">
                <code className="file-chip">{epic.id}</code>
                <button className="ghost-button" type="button" onClick={() => onEditEpic(epic)}>
                  Editar
                </button>
              </div>
            </article>
          ))
        ) : (
          <div className="empty-column">
            <p>No hay épicas en este proyecto.</p>
          </div>
        )}
      </section>
    </aside>
  );
}
