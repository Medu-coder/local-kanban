function renderSubtask(subtask, index, onToggleSubtask, isUpdatingSubtask, canMutate) {
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
          disabled={isUpdatingSubtask || !canMutate}
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

function ChecklistSection({ title, criteria, progress, onToggleCriterion, isUpdatingCriterion, canMutate }) {
  return (
    <section className="detail-section">
      <div className="detail-section__header detail-section__header--sticky">
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
                  disabled={!criterion.editable || isUpdatingCriterion || !canMutate}
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
  onOperationalChange,
}) {
  const [timeline, setTimeline] = useState(null);
  const [timelineRevision, setTimelineRevision] = useState(0);
  const [operationalError, setOperationalError] = useState("");

  useEffect(() => {
    let active = true;
    setTimeline(null);
    if (story) {
      fetchStoryTimeline(story.projectId, story.id)
        .then((result) => { if (active) setTimeline(result); })
        .catch((error) => { if (active) setOperationalError(error.message); });
    }
    return () => { active = false; };
  }, [story?.id, story?.projectId, story?.revision, timelineRevision]);

  if (!story) {
    return null;
  }

  const canPlan =
    story.status === "backlog" &&
    !story.quarantine &&
    !story.coordination?.claim;
  const canCheckInUi = canPlan && story.executionMode === "human";
  const canMarkReadiness = canPlan;
  const nextAction = story.quarantine
    ? "Resolver la cuarentena antes de continuar."
    : story.coordination?.claim?.status === "stale"
      ? `Recuperar o liberar el intento ${story.coordination.attempt?.id ?? "activo"}.`
      : story.coordination?.blocks?.length
        ? story.coordination.blocks[0].action
        : story.coordination?.checkpoint?.payload?.nextAction
          ?? (story.coordination?.claim
            ? "Continuar mediante la CLI con el attemptId y fencing token vigentes."
            : story.status === "backlog" && story.isReadyForDeveloping
              ? `local-kanban claim ${story.id}`
              : story.status === "backlog"
                ? "Completar la Definition of Ready antes de reclamar."
                : story.status === "testing"
                  ? "Revisar la entrega y completar como orquestador."
                  : "Consultar local-kanban next para la siguiente acción.");

  return (
    <aside className="detail-panel" onClick={(event) => event.stopPropagation()} data-testid="story-detail-panel">
      <div className="detail-panel__header">
        <div className="detail-panel__title-block">
          <p className="eyebrow">Historia</p>
          <h2>{story.title}</h2>
        </div>
        <div className="panel-actions">
          <button
            className="ghost-button"
            onClick={() => onEdit(story)}
            type="button"
            data-testid="edit-story-button"
            disabled={!canPlan}
            title={canPlan ? "Editar planificación" : "Solo se edita en backlog y sin claim activo"}
          >
            Editar
          </button>
          <button className="ghost-button" onClick={onClose} type="button" data-testid="close-story-detail-button">
            Cerrar
          </button>
        </div>
      </div>

      <div className="story-status-row">
        {story.quarantine ? <span className="status-chip status-chip--blocked">Cuarentena</span> : null}
        {story.coordination?.claim?.status === "stale" ? (
          <span className="status-chip status-chip--blocked">Lease stale</span>
        ) : null}
        {story.coordination?.operationalStatus ? (
          <span className="status-chip">{story.coordination.operationalStatus}</span>
        ) : null}
        {story.isBlocked ? <span className="status-chip status-chip--blocked">Blocked</span> : null}
        {story.status === "backlog" && story.isReadyForDeveloping ? (
          <span className="status-chip status-chip--ready">Ready</span>
        ) : null}
        {story.isDoneValidated ? <span className="status-chip status-chip--validated">Done validado</span> : null}
        <span className="status-chip">{story.executionMode}</span>
        <span className="status-chip">{story.storyType}</span>
        <span className={`status-chip ${story.risk === "high" ? "status-chip--blocked" : ""}`}>
          riesgo {story.risk}
        </span>
      </div>

      <section className="agent-next-action" data-testid="story-next-action">
        <span>Siguiente acción canónica</span>
        <strong>{nextAction}</strong>
      </section>

      {story.executionMode !== "human" ? (
        <p className="agent-policy-note" data-testid="agent-mutations-readonly">
          La aceptación y las subtareas son de solo lectura aquí. Usa <code>local-kanban check</code>
          con el intento y fencing token vigentes. La readiness manual puede confirmarse antes del claim.
        </p>
      ) : null}

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
          <dt>Rank</dt>
          <dd>{story.rank ?? "Sin rank"}</dd>
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

      {story.coordination ? (
        <section className="detail-section" data-testid="story-operational-state">
          <h3>Ejecución agéntica</h3>
          <dl className="detail-grid">
            <div><dt>Agente</dt><dd>{story.coordination.claim?.agentId ?? "Sin claim"}</dd></div>
            <div><dt>Intento</dt><dd>{story.coordination.attempt?.id ?? "—"}</dd></div>
            <div><dt>Fencing</dt><dd>{story.coordination.claim?.fencingToken ?? "—"}</dd></div>
            <div><dt>Lease</dt><dd>{story.coordination.claim?.leaseExpiresAt ? new Date(story.coordination.claim.leaseExpiresAt).toLocaleString() : "—"}</dd></div>
          </dl>
          {story.coordination.blocks?.length ? (
            <ul className="subtask-list">
              {story.coordination.blocks.map((block) => (
                <li key={block.id}>
                  <strong>{block.type}</strong>: {block.description}
                  <p className="muted">Acción: {block.action} · Responsable: {block.owner}</p>
                  <p className="muted">Reanudar cuando: {block.resumeCondition}</p>
                  {block.evidence ? <p className="muted">Evidencia: {block.evidence}</p> : null}
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={async () => {
                      if (!window.confirm(`Confirma que se cumple la condición de reanudación: ${block.resumeCondition}`)) {
                        return;
                      }
                      try {
                        setOperationalError("");
                        await resolveStoryBlock(story.projectId, story.id, block.id, {
                          attemptId: story.coordination.attempt.id,
                          fencingToken: story.coordination.claim.fencingToken,
                        });
                        await onOperationalChange?.();
                        setTimelineRevision((revision) => revision + 1);
                      } catch (error) { setOperationalError(error.message); }
                    }}
                  >Resolver</button>
                </li>
              ))}
            </ul>
          ) : null}
          {story.coordination.checkpoint ? (
            <p className="detail-copy"><strong>Checkpoint:</strong> {story.coordination.checkpoint.summary}</p>
          ) : null}
          {story.coordination.claim ? (
            <button
              className="ghost-button"
              type="button"
              onClick={async () => {
                if (!window.confirm("Esto abandonará el intento activo y liberará su claim. ¿Quieres continuar?")) {
                  return;
                }
                try {
                  setOperationalError("");
                  await releaseStoryClaim(story.projectId, story.id, {
                    attemptId: story.coordination.attempt.id,
                    fencingToken: story.coordination.claim.fencingToken,
                    outcome: "abandoned",
                  });
                  await onOperationalChange?.();
                  setTimelineRevision((revision) => revision + 1);
                } catch (error) { setOperationalError(error.message); }
              }}
            >Abandonar intento</button>
          ) : null}
          {operationalError ? <p className="error-banner">{operationalError}</p> : null}
        </section>
      ) : null}

      <section className="detail-section" data-testid="story-timeline">
        <h3>Timeline</h3>
        {timeline?.events?.length ? (
          <ol className="subtask-list">
            {timeline.events.map((event) => (
              <li key={event.id}>
                <strong>{event.eventType}</strong> · {event.actor} · {new Date(event.createdAt).toLocaleString()}
              </li>
            ))}
          </ol>
        ) : <p className="muted">Sin eventos operativos.</p>}
      </section>

      {story.quarantine ? (
        <section className="detail-section" data-testid="story-quarantine">
          <h3>Conflicto en cuarentena</h3>
          <p className="detail-copy">{story.quarantine.reason}</p>
        </section>
      ) : null}

      <section className="detail-section">
        <h3>Descripción</h3>
        <p className="detail-copy"><strong>Objetivo:</strong> {story.objective}</p>
        <p className="detail-copy">{story.description || "Sin resumen breve."}</p>
        <pre className="markdown-body">{story.body || "Sin contenido adicional."}</pre>
      </section>

      <section className="detail-section">
        <h3>Scope operativo</h3>
        <div className="relation-grid">
          <div>
            <p className="muted">Dentro de scope</p>
            {story.scope.length ? story.scope.map((item) => <code key={item} className="file-chip">{item}</code>) : <p className="muted">Sin scope declarado.</p>}
          </div>
          <div>
            <p className="muted">Fuera de scope</p>
            {story.nonScope.length ? story.nonScope.map((item) => <code key={item} className="file-chip">{item}</code>) : <p className="muted">Sin exclusiones declaradas.</p>}
          </div>
        </div>
      </section>

      <ChecklistSection
        title="Ready checklist"
        criteria={story.readyCriteria}
        progress={story.readyCriteriaProgress}
        onToggleCriterion={(index) => onToggleCriterion("ready", index)}
        isUpdatingCriterion={isUpdatingCriterion}
        canMutate={canMarkReadiness}
      />

      <ChecklistSection
        title="Done checklist"
        criteria={story.doneCriteria}
        progress={story.doneCriteriaProgress}
        onToggleCriterion={(index) => onToggleCriterion("done", index)}
        isUpdatingCriterion={isUpdatingCriterion}
        canMutate={canCheckInUi}
      />

      <section className="detail-section">
        <h3>Subtareas</h3>
        {story.subtasks.length ? (
          <ul className="subtask-list">
            {story.subtasks.map((subtask, index) =>
              renderSubtask(subtask, index, onToggleSubtask, isUpdatingSubtask, canCheckInUi)
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
        <h3>Validación declarada</h3>
        {story.validation?.commands?.length ? (
          <div className="file-chip-list">
            {story.validation.commands.map((command) => <code key={command} className="file-chip">{command}</code>)}
          </div>
        ) : <p className="muted">Sin comandos de validación.</p>}
      </section>

      <section className="detail-section">
        <h3>Evidencia</h3>
        {story.evidence.length ? (
          <ul className="subtask-list">
            {story.evidence.map((item) => (
              <li key={item.id}><strong>{item.type}</strong> · {item.actor} · <code>{item.commit}</code><br />{item.summary}</li>
            ))}
          </ul>
        ) : <p className="muted">Aún no hay evidencia vigente.</p>}
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
import { useEffect, useState } from "react";
import { fetchStoryTimeline, releaseStoryClaim, resolveStoryBlock } from "../lib/api";
