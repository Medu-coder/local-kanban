import { useMemo, useState } from "react";

function groupIssues(issues) {
  const groups = new Map();
  for (const issue of issues) {
    const key = `${issue.code}:${issue.summary}`;
    const current = groups.get(key) ?? { ...issue, entities: [] };
    if (issue.entityId) current.entities.push({ id: issue.entityId, type: issue.entityType });
    groups.set(key, current);
  }
  return [...groups.values()];
}

export function DegradationPanel({ project, onOpenEntity }) {
  const [copied, setCopied] = useState("");
  const groups = useMemo(
    () => groupIssues(project.degradations?.issues ?? []),
    [project.degradations?.issues],
  );
  if (!groups.length) return null;

  return (
    <section className="degradation-panel" data-testid="project-degraded" aria-labelledby="degradation-title">
      <div className="degradation-panel__header">
        <div>
          <p className="eyebrow">Atención requerida</p>
          <h3 id="degradation-title">{project.degradations.issueCount} garantía(s) degradada(s)</h3>
        </div>
        <span className="status-chip status-chip--blocked">Flujo bloqueado</span>
      </div>
      <p>
        El tablero sigue siendo consultable, pero no es seguro planificar ni ejecutar hasta resolver
        estas causas. Ningún estado mostrado debe interpretarse como canónico cuando su entidad está afectada.
      </p>

      <div className="degradation-list">
        {groups.map((issue) => (
          <details key={`${issue.code}:${issue.summary}`} className="degradation-item" open={groups.length === 1}>
            <summary>
              <span>{issue.summary}</span>
              <strong>{issue.entities.length || 1}</strong>
            </summary>
            <dl className="degradation-item__contract">
              <div><dt>Causa</dt><dd>{issue.cause}</dd></div>
              <div><dt>Impacto</dt><dd>{issue.impact}</dd></div>
              <div><dt>Siguiente acción</dt><dd>{issue.action}</dd></div>
              <div><dt>Verificación</dt><dd>{issue.verification}</dd></div>
            </dl>
            {issue.command ? (
              <div className="degradation-command">
                <code>{issue.command}</code>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(issue.command);
                    setCopied(issue.command);
                  }}
                >
                  {copied === issue.command ? "Copiado" : "Copiar comando"}
                </button>
              </div>
            ) : null}
            {issue.entities.length ? (
              <div className="degradation-entities" aria-label="Entidades afectadas">
                {issue.entities.map((entity) => (
                  <button
                    key={`${entity.type}:${entity.id}`}
                    className="file-chip degradation-entity"
                    type="button"
                    onClick={() => onOpenEntity?.(entity)}
                  >
                    {entity.id}
                  </button>
                ))}
              </div>
            ) : null}
          </details>
        ))}
      </div>
    </section>
  );
}
