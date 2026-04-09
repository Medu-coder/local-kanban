function renderSubtask(subtask, index, onToggleSubtask, isUpdatingSubtask) {
  if (typeof subtask === "string") {
    return (
      <li key={`${subtask}-${index}`}>
        <span className="subtask-state" />
        <span>{subtask}</span>
      </li>
    );
  }

  return (
    <li key={`${subtask.title}-${index}`}>
      <label className="detail-subtask-toggle">
        <input
          type="checkbox"
          checked={Boolean(subtask.done)}
          onChange={() => onToggleSubtask(index)}
          disabled={isUpdatingSubtask}
        />
        <span className={`subtask-state ${subtask.done ? "is-done" : ""}`} />
        <span>{subtask.title}</span>
      </label>
    </li>
  );
}

function renderStoryReference(story) {
  return (
    <article key={`${story.id}-${story.status}`} className="epic-story-item">
      <div>
        <strong>{story.title}</strong>
        <p className="muted">{story.exists ? story.status : "Referencia huérfana"}</p>
      </div>
      <code className="file-chip">{story.id}</code>
    </article>
  );
}

function ChecklistSection({ title, criteria, progress, onToggleCriterion, isUpdatingCriterion }) {
  return (
    <section className="detail-section">
      <div className="detail-panel__header detail-panel__header--compact">
        <h3>{title}</h3>
        <span className="count-pill">
          {progress.completed}/{progress.total}
        </span>
      </div>

      {criteria.length ? (
        <ul className="subtask-list">
          {criteria.map((criterion, index) => (
            <li key={criterion.id}>
              <label className={`detail-subtask-toggle ${criterion.editable ? "" : "is-readonly"}`}>
                <input
                  type="checkbox"
                  checked={Boolean(criterion.checked)}
                  disabled={!criterion.editable || isUpdatingCriterion}
                  onChange={() => onToggleCriterion(index)}
                />
                <span className={`subtask-state ${criterion.checked ? "is-done" : ""}`} />
                <span>{criterion.label}</span>
                <span className="criteria-badge">{criterion.kind}</span>
                {criterion.rule ? <span className="criteria-rule">{criterion.rule}</span> : null}
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No hay criterios definidos.</p>
      )}
    </section>
  );
}

export function StoryDetail({
  story,
  onClose,
  onEdit,
  onToggleSubtask,
  onToggleCriterion,
  isUpdatingSubtask,
  isUpdatingCriterion,
}) {
  if (!story) {
    return null;
  }

  return (
    <aside className="detail-panel" onClick={(event) => event.stopPropagation()} data-testid="story-detail-panel">
      <div className="detail-panel__header">
        <div className="detail-panel__title-block">
          <p className="eyebrow">Historia</p>
          <h2>{story.title}</h2>
        </div>
        <div className="panel-actions">
          <button className="ghost-button" onClick={() => onEdit(story)} type="button" data-testid="edit-story-button">
            Editar
          </button>
          <button className="ghost-button" onClick={onClose} type="button" data-testid="close-story-detail-button">
            Cerrar
          </button>
        </div>
      </div>

      <div className="story-status-row">
        {story.isBlocked ? <span className="status-chip status-chip--blocked">Blocked</span> : null}
        {story.isReadyForDeveloping ? <span className="status-chip status-chip--ready">Ready</span> : null}
        {story.isDoneValidated ? <span className="status-chip status-chip--validated">Done validado</span> : null}
        <span className="status-chip">{story.executionMode}</span>
        <span className="status-chip">{story.storyType}</span>
      </div>

      <dl className="detail-grid">
        <div>
          <dt>ID</dt>
          <dd>{story.id}</dd>
        </div>
        <div>
          <dt>Proyecto</dt>
          <dd>{story.projectName}</dd>
        </div>
        <div>
          <dt>Épica</dt>
          <dd>{story.epicTitle}</dd>
        </div>
        <div>
          <dt>Estado</dt>
          <dd>{story.status}</dd>
        </div>
        <div>
          <dt>Prioridad</dt>
          <dd>{story.priority}</dd>
        </div>
        <div>
          <dt>Asignado</dt>
          <dd>{story.assignee || "Sin asignar"}</dd>
        </div>
        <div>
          <dt>Agent owner</dt>
          <dd>{story.agentOwner || "Sin agente"}</dd>
        </div>
        <div>
          <dt>Ultima actualizacion</dt>
          <dd>{story.lastAgentUpdate ? new Date(story.lastAgentUpdate).toLocaleString() : "Sin fecha"}</dd>
        </div>
      </dl>

      <section className="detail-section">
        <h3>Descripción</h3>
        <p className="detail-copy">{story.description || "Sin resumen breve."}</p>
        <pre className="markdown-body">{story.body || "Sin contenido adicional."}</pre>
      </section>

      <ChecklistSection
        title="Ready checklist"
        criteria={story.readyCriteria}
        progress={story.readyCriteriaProgress}
        onToggleCriterion={(index) => onToggleCriterion("ready", index)}
        isUpdatingCriterion={isUpdatingCriterion}
      />

      <ChecklistSection
        title="Done checklist"
        criteria={story.doneCriteria}
        progress={story.doneCriteriaProgress}
        onToggleCriterion={(index) => onToggleCriterion("done", index)}
        isUpdatingCriterion={isUpdatingCriterion}
      />

      <section className="detail-section">
        <h3>Subtareas</h3>
        {story.subtasks.length ? (
          <ul className="subtask-list">
            {story.subtasks.map((subtask, index) =>
              renderSubtask(subtask, index, onToggleSubtask, isUpdatingSubtask)
            )}
          </ul>
        ) : (
          <p className="muted">No hay subtareas definidas.</p>
        )}
      </section>

      <section className="detail-section">
        <h3>Dependencias</h3>
        <div className="relation-grid">
          <div>
            <p className="muted">Blocked by</p>
            {story.blockedByStories.length ? story.blockedByStories.map(renderStoryReference) : <p className="muted">Sin dependencias de entrada.</p>}
          </div>
          <div>
            <p className="muted">Blocks</p>
            {story.blockingStories.length ? story.blockingStories.map(renderStoryReference) : <p className="muted">No bloquea otras historias.</p>}
          </div>
          <div>
            <p className="muted">Related to</p>
            {story.relatedStories.length ? story.relatedStories.map(renderStoryReference) : <p className="muted">Sin historias relacionadas.</p>}
          </div>
        </div>
      </section>

      <section className="detail-section">
        <h3>Context files</h3>
        {story.contextFiles.length ? (
          <div className="file-chip-list">
            {story.contextFiles.map((filePath) => (
              <code key={filePath} className="file-chip">
                {filePath}
              </code>
            ))}
          </div>
        ) : (
          <p className="muted">No hay contexto definido.</p>
        )}
      </section>

      <section className="detail-section">
        <h3>Agent status note</h3>
        <p className="detail-copy">{story.agentStatusNote || "Sin nota operativa."}</p>
      </section>

      <section className="detail-section">
        <h3>Archivo fuente</h3>
        <code className="file-chip">{story.filePath}</code>
      </section>
    </aside>
  );
}
