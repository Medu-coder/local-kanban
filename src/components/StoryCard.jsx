export function StoryCard({ story, onSelect, onDragStart, onDragEnd, canDrag }) {
  const doneSubtasks = story.subtasks.filter((subtask) =>
    typeof subtask === "object" ? subtask.done : false
  ).length;
  const owner = story.agentOwner || story.assignee || "Sin asignar";

  function handleActivate() {
    onSelect(story);
  }

  return (
    <article
      className="story-card"
      data-testid={`story-card-${story.id}`}
      draggable={canDrag}
      title={canDrag ? "Reorganizar esta historia de backlog entre épicas" : "El estado operativo se gestiona mediante la CLI"}
      role="button"
      tabIndex={0}
      onClick={(event) => {
        event.stopPropagation();
        handleActivate();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleActivate();
        }
      }}
      onDragStart={() => {
        if (canDrag) onDragStart(story);
      }}
      onDragEnd={onDragEnd}
    >
      <div className="story-card__top">
        <span className="story-card__key">{story.id}</span>
        <span className={`priority-badge priority-${story.priority}`}>{story.priority}</span>
      </div>

      <h3>{story.title}</h3>
      {story.epicTitle ? <p className="story-card__epic">{story.epicTitle}</p> : null}

      <div className="story-card__flags">
        {story.quarantine ? <span className="status-chip status-chip--blocked">Cuarentena</span> : null}
        {story.coordination?.claim?.status === "stale" ? (
          <span className="status-chip status-chip--blocked">Lease stale</span>
        ) : null}
        {story.coordination?.operationalStatus && story.coordination.operationalStatus !== "unclaimed" ? (
          <span className="status-chip">{story.coordination.operationalStatus}</span>
        ) : null}
        {story.isBlocked ? <span className="status-chip status-chip--blocked">Blocked</span> : null}
        {story.status === "backlog" && story.isReadyForDeveloping ? (
          <span className="status-chip status-chip--ready">Ready</span>
        ) : null}
        {story.isDoneValidated ? <span className="status-chip status-chip--validated">Done validado</span> : null}
      </div>

      <div className="story-card__footer">
        <div className="story-card__meta-group">
          <span className="story-card__meta-label">Owner</span>
          <strong className="story-card__meta-value story-card__meta-value--owner">{owner}</strong>
        </div>
        <div className="story-card__meta-group story-card__meta-group--stats">
          <span className="story-card__meta-label">Subtareas</span>
          <strong className="story-card__meta-value story-card__meta-value--numeric">
            {doneSubtasks}/{story.subtasks.length || 0}
          </strong>
        </div>
      </div>
    </article>
  );
}
