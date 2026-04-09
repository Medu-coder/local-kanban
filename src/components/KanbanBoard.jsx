import { StoryCard } from "./StoryCard";

const statuses = [
  { id: "backlog", label: "Backlog" },
  { id: "developing", label: "Developing" },
  { id: "testing", label: "Testing" },
  { id: "done", label: "Done" },
];
const epicProgressWeights = {
  backlog: 0,
  developing: 1,
  testing: 2,
  done: 4,
};

function buildEpicLanes(project) {
  const storiesByEpic = project.stories.reduce((acc, story) => {
    const key = story.epicId ?? "__no_epic__";
    if (!acc[key]) {
      acc[key] = [];
    }

    acc[key].push(story);
    return acc;
  }, {});

  const epicLanes = project.epics.map((epic) => {
    const stories = storiesByEpic[epic.id] ?? [];
    const statusCounts = statuses.reduce((acc, status) => {
      acc[status.id] = stories.filter((story) => story.status === status.id).length;
      return acc;
    }, {});
    const storyCount = stories.length;
    const doneCount = statusCounts.done ?? 0;
    const progressScore = statuses.reduce(
      (acc, status) => acc + statusCounts[status.id] * epicProgressWeights[status.id],
      0
    );
    const progressMax = storyCount * epicProgressWeights.done;

    return {
      id: epic.id,
      title: epic.title,
      description: epic.description,
      progressScore,
      progressMax,
      progressPercent: progressMax ? Math.round((progressScore / progressMax) * 100) : 0,
      storyCount,
      doneCount,
      statusCounts,
      storiesByStatus: statuses.reduce((acc, status) => {
        acc[status.id] = stories.filter((story) => story.status === status.id);
        return acc;
      }, {}),
    };
  });

  if (storiesByEpic.__no_epic__?.length) {
    epicLanes.push({
      id: "__no_epic__",
      title: "Sin épica",
      description: "Historias no asociadas a ninguna épica.",
      storyCount: storiesByEpic.__no_epic__.length,
      doneCount: storiesByEpic.__no_epic__.filter((story) => story.status === "done").length,
      statusCounts: statuses.reduce((acc, status) => {
        acc[status.id] = storiesByEpic.__no_epic__.filter((story) => story.status === status.id).length;
        return acc;
      }, {}),
      storiesByStatus: statuses.reduce((acc, status) => {
        acc[status.id] = storiesByEpic.__no_epic__.filter((story) => story.status === status.id);
        return acc;
      }, {}),
    });

    const lane = epicLanes[epicLanes.length - 1];
    lane.progressScore = statuses.reduce(
      (acc, status) => acc + lane.statusCounts[status.id] * epicProgressWeights[status.id],
      0
    );
    lane.progressMax = lane.storyCount * epicProgressWeights.done;
    lane.progressPercent = lane.progressMax
      ? Math.round((lane.progressScore / lane.progressMax) * 100)
      : 0;
  }

  return epicLanes;
}

export function KanbanBoard({
  project,
  onSelectStory,
  onDropStory,
  draggedStory,
  onDragStart,
  onDragEnd,
  onBackgroundClick,
  onSelectEpic,
  onQuickCreateStory,
  collapsedLanes,
  onToggleLane,
}) {
  const epicLanes = buildEpicLanes(project);

  function handleBoardSurfaceClick(event) {
    if (event.target.closest("[data-sidepanel-action='true']")) {
      return;
    }

    event.stopPropagation();
    onBackgroundClick();
  }

  return (
    <section className="board-surface" onClick={handleBoardSurfaceClick} data-testid="kanban-board">
      <div className="board-status-row">
        {statuses.map((status) => (
          <header key={status.id} className="board-column board-column--header">
            <div className="board-column__header">
              <div>
                <p className="eyebrow">Stage</p>
                <h2>{status.label}</h2>
              </div>
              <span className="count-pill">{project.stats[status.id] ?? 0}</span>
            </div>
          </header>
        ))}
      </div>

      <div className="epic-lane-list">
        {epicLanes.map((lane) => (
          <section key={lane.id} className="epic-lane" data-testid={`epic-lane-${lane.id}`}>
            <div className="epic-lane__summary">
              <div className="epic-lane__meta">
                <div>
                  <p className="eyebrow">Epic</p>
                  <button
                    className="epic-lane__title-button"
                    type="button"
                    data-sidepanel-action="true"
                    data-testid={`epic-lane-title-${lane.id}`}
                    onClick={() => {
                      if (lane.id !== "__no_epic__") {
                        onSelectEpic(lane.id);
                      }
                    }}
                  >
                    <span className="epic-lane__title">{lane.title}</span>
                  </button>
                  <p className="muted">{lane.description || "Sin descripción breve."}</p>
                </div>
                <div className="epic-lane__progress">
                  <small>{lane.storyCount} historias</small>
                  <strong>
                    {lane.progressScore}/{lane.progressMax}
                  </strong>
                  <span>{lane.progressPercent}%</span>
                </div>
                <div className="epic-lane__actions">
                  <button
                    className="ghost-button"
                    type="button"
                    data-sidepanel-action="true"
                    data-testid={`quick-create-epic-${lane.id}`}
                    onClick={() => onQuickCreateStory(lane.id, "backlog")}
                  >
                    Nueva historia
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    data-sidepanel-action="true"
                    data-testid={`toggle-lane-${lane.id}`}
                    onClick={() => onToggleLane(lane.id)}
                  >
                    {collapsedLanes[lane.id] ? "Expandir" : "Contraer"}
                  </button>
                </div>
              </div>

              <div className="progress-track">
                <span
                  className="progress-track__fill"
                  style={{ width: `${lane.progressPercent}%` }}
                />
              </div>
            </div>

            {!collapsedLanes[lane.id] ? (
              <div className="epic-lane__grid">
              {statuses.map((status) => (
                <div
                  key={`${lane.id}-${status.id}`}
                  className={`board-column epic-lane__column ${draggedStory ? "is-drop-ready" : ""}`}
                  data-testid={`dropzone-${lane.id}-${status.id}`}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => onDropStory(status.id, lane.id)}
                >
                  <div className="epic-lane__column-inner">
                    <button
                      className="quick-create-button"
                      type="button"
                      data-sidepanel-action="true"
                      data-testid={`quick-create-${lane.id}-${status.id}`}
                      onClick={() => onQuickCreateStory(lane.id, status.id)}
                    >
                      + Crear historia
                    </button>

                    {lane.storiesByStatus[status.id].length ? (
                      <div className="story-stack">
                        {lane.storiesByStatus[status.id].map((story) => (
                          <StoryCard
                            key={story.id}
                            story={story}
                            onSelect={onSelectStory}
                            onDragStart={onDragStart}
                            onDragEnd={onDragEnd}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="epic-lane__empty">Sin historias</div>
                    )}
                  </div>
                </div>
              ))}
              </div>
            ) : null}
          </section>
        ))}
      </div>
    </section>
  );
}
