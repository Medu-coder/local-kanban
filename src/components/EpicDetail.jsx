const statusLabels = {
  backlog: "Backlog",
  developing: "Developing",
  testing: "Testing",
  done: "Done",
};

export function EpicDetail({ epic, stories, onClose, onEdit, onCreateStory }) {
  if (!epic) {
    return null;
  }

  const statusCounts = epic.statusCounts ?? {
    backlog: 0,
    developing: 0,
    testing: 0,
    done: 0,
  };

  return (
    <aside className="detail-panel" onClick={(event) => event.stopPropagation()}>
      <div className="detail-panel__header">
        <div className="detail-panel__title-block">
          <p className="eyebrow">Épica</p>
          <h2>{epic.title}</h2>
        </div>
        <div className="panel-actions">
          <button className="ghost-button" type="button" onClick={() => onEdit(epic)}>
            Editar
          </button>
          <button className="ghost-button" type="button" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>

      <section className="detail-section">
        <div className="epic-progress-card">
          <div className="epic-progress-card__header">
            <div>
              <p className="eyebrow">Progreso</p>
              <strong>
                {epic.progressScore ?? 0}/{epic.progressMax ?? 0} progreso total
              </strong>
            </div>
            <span className="count-pill">{epic.progressPercent ?? 0}%</span>
          </div>
          <div className="progress-track">
            <span
              className="progress-track__fill"
              style={{ width: `${epic.progressPercent ?? 0}%` }}
            />
          </div>
        </div>
      </section>

      <section className="detail-section">
        <h3>Resumen por estado</h3>
        <div className="epic-status-grid">
          {Object.entries(statusCounts).map(([status, count]) => (
            <div key={status} className="epic-status-card">
              <dt>{statusLabels[status]}</dt>
              <dd>{count}</dd>
            </div>
          ))}
        </div>
      </section>

      <section className="detail-section">
        <h3>Descripción</h3>
        <p className="detail-copy">{epic.description || "Sin resumen breve."}</p>
        <pre className="markdown-body">{epic.body || "Sin contenido adicional."}</pre>
      </section>

      <section className="detail-section">
        <div className="detail-section__header">
          <h3>Historias de la épica</h3>
          <button className="primary-button" type="button" onClick={() => onCreateStory(epic.id, "backlog")}>
            Nueva historia
          </button>
        </div>
        {stories.length ? (
          <div className="epic-story-list">
            {stories.map((story) => (
              <article key={story.id} className="epic-story-item">
                <div>
                  <strong>{story.title}</strong>
                  <p className="muted">{story.status}</p>
                </div>
                <code className="file-chip">{story.id}</code>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted">No hay historias asociadas a esta épica.</p>
        )}
      </section>
    </aside>
  );
}
