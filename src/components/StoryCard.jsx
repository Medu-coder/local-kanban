export function StoryCard({ story, onSelect, onDragStart, onDragEnd }) {
  const doneSubtasks = story.subtasks.filter((subtask) =>
    typeof subtask === "object" ? subtask.done : false
  ).length;

  return (
    <article
      className="story-card"
      data-testid={`story-card-${story.id}`}
      draggable
      onClick={(event) => {
        event.stopPropagation();
        onSelect(story);
      }}
      onDragStart={() => onDragStart(story)}
      onDragEnd={onDragEnd}
    >
      <div className="story-card__top">
        <span className="story-card__key">{story.id}</span>
        <span className={`priority-badge priority-${story.priority}`}>{story.priority}</span>
      </div>

      <h3>{story.title}</h3>
      <p className="story-card__epic">{story.epicTitle}</p>

      <div className="story-card__flags">
        {story.isBlocked ? <span className="status-chip status-chip--blocked">Blocked</span> : null}
        {story.isReadyForDeveloping ? <span className="status-chip status-chip--ready">Ready</span> : null}
        {story.isDoneValidated ? <span className="status-chip status-chip--validated">Done validado</span> : null}
      </div>

      <div className="story-card__meta">
        <span>{story.agentOwner || story.assignee || "Sin asignar"}</span>
        <span>
          {doneSubtasks}/{story.subtasks.length || 0} subtareas
        </span>
      </div>
    </article>
  );
}
