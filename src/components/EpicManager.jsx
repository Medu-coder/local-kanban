export function EpicManager({ project, onCreateEpic, onEditEpic, onClose }) {
  return (
    <aside
      className="detail-panel epic-manager-panel"
      onClick={(event) => event.stopPropagation()}
      data-testid="epic-manager-panel"
    >
      <div className="detail-panel__header">
        <div className="detail-panel__title-block epic-manager__hero">
          <p className="eyebrow">Épicas</p>
          <h2 className="epic-manager__project-title">{project.name}</h2>
        </div>
        <div className="panel-actions epic-manager__actions">
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
                <div className="epic-manager-card__title">
                  <p className="eyebrow">Epic</p>
                  <h3>{epic.title}</h3>
                </div>
                <span className="count-pill">{epic.storyCount ?? 0}</span>
              </div>
              <p className="muted epic-manager-card__description">{epic.description || "Sin descripcion breve."}</p>
              <div className="epic-manager-card__footer">
                <code className="file-chip epic-manager-card__id" title={epic.id}>
                  {epic.id}
                </code>
                <button className="ghost-button epic-manager-card__edit" type="button" onClick={() => onEditEpic(epic)}>
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
