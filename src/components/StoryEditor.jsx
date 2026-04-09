import { useEffect, useRef, useState } from "react";

const emptySubtask = { title: "", done: false };
const defaultDerivedRule = "dependencies_done";

function createUiKey(prefix = "item") {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function hydrateSubtask(subtask) {
  if (typeof subtask === "string") {
    return { title: subtask, done: false, uiKey: createUiKey("subtask") };
  }

  return {
    title: subtask.title ?? "",
    done: Boolean(subtask.done),
    uiKey: subtask.uiKey ?? createUiKey("subtask"),
  };
}

function hydrateCriterion(criterion) {
  if (typeof criterion === "string") {
    return {
      id: "",
      label: criterion,
      kind: "manual",
      checked: false,
      rule: defaultDerivedRule,
      uiKey: createUiKey("criterion"),
    };
  }

  return {
    id: criterion.id ?? "",
    label: criterion.label ?? "",
    kind: criterion.kind === "derived" ? "derived" : "manual",
    checked: Boolean(criterion.checked),
    rule: criterion.rule ?? defaultDerivedRule,
    uiKey: criterion.uiKey ?? createUiKey("criterion"),
  };
}

function listToString(values, separator = ", ") {
  return Array.isArray(values) ? values.join(separator) : "";
}

function parseInlineList(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseMultilineList(value) {
  return String(value ?? "")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatDateTimeLocal(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60_000);
  return localDate.toISOString().slice(0, 16);
}

function normalizeCriteria(criteria) {
  return criteria
    .map((criterion, index) => {
      const label = criterion.label.trim();
      if (!label) {
        return null;
      }

      return {
        id: criterion.id.trim() || `criterion-${index + 1}`,
        label,
        kind: criterion.kind === "derived" ? "derived" : "manual",
        ...(criterion.kind === "derived"
          ? { rule: criterion.rule || defaultDerivedRule }
          : { checked: Boolean(criterion.checked) }),
      };
    })
    .filter(Boolean);
}

function makeInitialState(project, story, draft) {
  if (story) {
    return {
      id: story.id,
      title: story.title ?? "",
      description: story.description ?? "",
      epicId: story.epicId ?? "",
      status: story.status ?? "backlog",
      priority: story.priority ?? "medium",
      assignee: story.assignee ?? "",
      agentOwner: story.agentOwner ?? "",
      executionMode: story.executionMode ?? "human",
      storyType: story.storyType ?? "feature",
      labels: listToString(story.labels),
      blockedBy: listToString(story.blockedBy),
      blocks: listToString(story.blocks),
      relatedTo: listToString(story.relatedTo),
      contextFiles: listToString(story.contextFiles, "\n"),
      agentStatusNote: story.agentStatusNote ?? "",
      lastAgentUpdate: formatDateTimeLocal(story.lastAgentUpdate),
      body: story.body ?? "",
      subtasks: Array.isArray(story.subtasks) && story.subtasks.length
        ? story.subtasks.map(hydrateSubtask)
        : [{ ...emptySubtask, uiKey: createUiKey("subtask") }],
      readyCriteria: Array.isArray(story.readyCriteria) && story.readyCriteria.length
        ? story.readyCriteria.map(hydrateCriterion)
        : [],
      doneCriteria: Array.isArray(story.doneCriteria) && story.doneCriteria.length
        ? story.doneCriteria.map(hydrateCriterion)
        : [],
    };
  }

  return {
    id: "",
    title: "",
    description: "",
    epicId: draft?.epicId ?? "",
    status: draft?.status ?? "backlog",
    priority: "medium",
    assignee: "",
    agentOwner: "",
    executionMode: "human",
    storyType: "feature",
    labels: "",
    blockedBy: "",
    blocks: "",
    relatedTo: "",
    contextFiles: "",
    agentStatusNote: "",
    lastAgentUpdate: "",
    body: "",
    subtasks: [{ ...emptySubtask, uiKey: createUiKey("subtask") }],
    readyCriteria: [],
    doneCriteria: [],
  };
}

function normalizeFormState(project, story, draft) {
  const baseState = makeInitialState(project, story, draft);

  return {
    id: baseState.id.trim(),
    title: baseState.title.trim(),
    description: baseState.description.trim(),
    epicId: baseState.epicId || "",
    status: baseState.status,
    priority: baseState.priority,
    assignee: baseState.assignee.trim(),
    agentOwner: baseState.agentOwner.trim(),
    executionMode: baseState.executionMode,
    storyType: baseState.storyType,
    labels: parseInlineList(baseState.labels),
    blockedBy: parseInlineList(baseState.blockedBy),
    blocks: parseInlineList(baseState.blocks),
    relatedTo: parseInlineList(baseState.relatedTo),
    contextFiles: parseMultilineList(baseState.contextFiles),
    agentStatusNote: baseState.agentStatusNote.trim(),
    lastAgentUpdate: baseState.lastAgentUpdate ? new Date(baseState.lastAgentUpdate).toISOString() : null,
    body: baseState.body.trim(),
    subtasks: baseState.subtasks
      .map((subtask) => ({
        title: subtask.title.trim(),
        done: Boolean(subtask.done),
      }))
      .filter((subtask) => subtask.title),
    readyCriteria: normalizeCriteria(baseState.readyCriteria),
    doneCriteria: normalizeCriteria(baseState.doneCriteria),
  };
}

export function StoryEditor({
  project,
  story,
  draft,
  onClose,
  onSubmit,
  isSaving,
  onDirtyChange,
  onRegisterSubmit,
}) {
  const [form, setForm] = useState(() => makeInitialState(project, story, draft));
  const formRef = useRef(null);

  useEffect(() => {
    setForm(makeInitialState(project, story, draft));
  }, [draft, project, story]);

  useEffect(() => {
    const initialState = normalizeFormState(project, story, draft);
    const currentState = {
      id: form.id.trim(),
      title: form.title.trim(),
      description: form.description.trim(),
      epicId: form.epicId || "",
      status: form.status,
      priority: form.priority,
      assignee: form.assignee.trim(),
      agentOwner: form.agentOwner.trim(),
      executionMode: form.executionMode,
      storyType: form.storyType,
      labels: parseInlineList(form.labels),
      blockedBy: parseInlineList(form.blockedBy),
      blocks: parseInlineList(form.blocks),
      relatedTo: parseInlineList(form.relatedTo),
      contextFiles: parseMultilineList(form.contextFiles),
      agentStatusNote: form.agentStatusNote.trim(),
      lastAgentUpdate: form.lastAgentUpdate ? new Date(form.lastAgentUpdate).toISOString() : null,
      body: form.body.trim(),
      subtasks: form.subtasks
        .map((subtask) => ({
          title: subtask.title.trim(),
          done: Boolean(subtask.done),
        }))
        .filter((subtask) => subtask.title),
      readyCriteria: normalizeCriteria(form.readyCriteria),
      doneCriteria: normalizeCriteria(form.doneCriteria),
    };

    onDirtyChange?.(JSON.stringify(currentState) !== JSON.stringify(initialState));
  }, [draft, form, onDirtyChange, project, story]);

  useEffect(() => {
    onRegisterSubmit?.(() => formRef.current?.requestSubmit());
    return () => {
      onRegisterSubmit?.(null);
    };
  }, [onRegisterSubmit]);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateSubtask(index, field, value) {
    setForm((current) => ({
      ...current,
      subtasks: current.subtasks.map((subtask, subtaskIndex) =>
        subtaskIndex === index ? { ...subtask, [field]: value } : subtask
      ),
    }));
  }

  function addSubtask() {
    setForm((current) => ({
      ...current,
      subtasks: [...current.subtasks, { ...emptySubtask, uiKey: createUiKey("subtask") }],
    }));
  }

  function removeSubtask(index) {
    setForm((current) => ({
      ...current,
      subtasks: current.subtasks.filter((_, subtaskIndex) => subtaskIndex !== index),
    }));
  }

  function updateCriteria(criteriaField, index, field, value) {
    setForm((current) => ({
      ...current,
      [criteriaField]: current[criteriaField].map((criterion, criterionIndex) =>
        criterionIndex === index
          ? {
              ...criterion,
              [field]: value,
              ...(field === "kind" && value === "manual"
                ? { checked: Boolean(criterion.checked) }
                : {}),
              ...(field === "kind" && value === "derived"
                ? { rule: criterion.rule || defaultDerivedRule }
                : {}),
            }
          : criterion
      ),
    }));
  }

  function addCriterion(criteriaField) {
    setForm((current) => ({
      ...current,
      [criteriaField]: [
        ...current[criteriaField],
        {
          id: "",
          label: "",
          kind: "manual",
          checked: false,
          rule: defaultDerivedRule,
          uiKey: createUiKey("criterion"),
        },
      ],
    }));
  }

  function removeCriterion(criteriaField, index) {
    setForm((current) => ({
      ...current,
      [criteriaField]: current[criteriaField].filter((_, criterionIndex) => criterionIndex !== index),
    }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    onSubmit({
      id: form.id.trim() || undefined,
      title: form.title,
      description: form.description,
      epicId: form.epicId || null,
      status: form.status,
      priority: form.priority,
      assignee: form.assignee.trim() || null,
      agentOwner: form.agentOwner.trim() || null,
      executionMode: form.executionMode,
      storyType: form.storyType,
      blockedBy: parseInlineList(form.blockedBy),
      blocks: parseInlineList(form.blocks),
      relatedTo: parseInlineList(form.relatedTo),
      contextFiles: parseMultilineList(form.contextFiles),
      agentStatusNote: form.agentStatusNote.trim(),
      lastAgentUpdate: form.lastAgentUpdate ? new Date(form.lastAgentUpdate).toISOString() : null,
      labels: parseInlineList(form.labels),
      body: form.body,
      subtasks: form.subtasks
        .map((subtask) => ({ title: subtask.title.trim(), done: Boolean(subtask.done) }))
        .filter((subtask) => subtask.title),
      readyCriteria: normalizeCriteria(form.readyCriteria),
      doneCriteria: normalizeCriteria(form.doneCriteria),
    });
  }

  return (
    <aside className="editor-panel" onClick={(event) => event.stopPropagation()} data-testid="story-editor-panel">
      <div className="detail-panel__header">
        <div className="detail-panel__title-block">
          <p className="eyebrow">{story ? "Editar" : "Nueva"}</p>
          <h2>{story ? story.title : "Historia"}</h2>
        </div>
        <button className="ghost-button" type="button" onClick={onClose} data-testid="close-story-editor-button">
          Cerrar
        </button>
      </div>

      <form ref={formRef} className="editor-form" onSubmit={handleSubmit}>
        <label className="field">
          <span>ID</span>
          <input
            data-testid="story-id-input"
            value={form.id}
            onChange={(event) => updateField("id", event.target.value)}
            disabled={Boolean(story)}
            placeholder="STO-001 o vacio para autogenerar"
          />
        </label>

        <label className="field">
          <span>Titulo</span>
          <input data-testid="story-title-input" value={form.title} onChange={(event) => updateField("title", event.target.value)} required />
        </label>

        <label className="field">
          <span>Descripcion</span>
          <textarea
            rows="3"
            value={form.description}
            onChange={(event) => updateField("description", event.target.value)}
          />
        </label>

        <div className="field-grid">
          <label className="field">
            <span>Epica</span>
            <select data-testid="story-epic-select" value={form.epicId} onChange={(event) => updateField("epicId", event.target.value)}>
              <option value="">Sin epica</option>
              {project.epics.map((epic) => (
                <option key={epic.id} value={epic.id}>
                  {epic.title}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Estado</span>
            <select data-testid="story-status-select" value={form.status} onChange={(event) => updateField("status", event.target.value)}>
              <option value="backlog">Backlog</option>
              <option value="developing">Developing</option>
              <option value="testing">Testing</option>
              <option value="done">Done</option>
            </select>
          </label>
        </div>

        <div className="field-grid">
          <label className="field">
            <span>Prioridad</span>
            <select data-testid="story-priority-select" value={form.priority} onChange={(event) => updateField("priority", event.target.value)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>

          <label className="field">
            <span>Tipo</span>
            <select data-testid="story-type-select" value={form.storyType} onChange={(event) => updateField("storyType", event.target.value)}>
              <option value="feature">Feature</option>
              <option value="bug">Bug</option>
              <option value="tech_debt">Tech debt</option>
              <option value="research">Research</option>
              <option value="chore">Chore</option>
            </select>
          </label>
        </div>

        <div className="field-grid">
          <label className="field">
            <span>Assignee</span>
            <input data-testid="story-assignee-input" value={form.assignee} onChange={(event) => updateField("assignee", event.target.value)} />
          </label>

          <label className="field">
            <span>Agent owner</span>
            <input
              data-testid="story-agent-owner-input"
              value={form.agentOwner}
              onChange={(event) => updateField("agentOwner", event.target.value)}
              placeholder="codex-main"
            />
          </label>
        </div>

        <div className="field-grid">
          <label className="field">
            <span>Execution mode</span>
            <select data-testid="story-execution-mode-select" value={form.executionMode} onChange={(event) => updateField("executionMode", event.target.value)}>
              <option value="human">Human</option>
              <option value="agent">Agent</option>
              <option value="hybrid">Hybrid</option>
            </select>
          </label>

          <label className="field">
            <span>Ultima actualizacion agente</span>
            <input
              data-testid="story-last-agent-update-input"
              type="datetime-local"
              value={form.lastAgentUpdate}
              onChange={(event) => updateField("lastAgentUpdate", event.target.value)}
            />
          </label>
        </div>

        <label className="field">
          <span>Labels</span>
          <input
            data-testid="story-labels-input"
            value={form.labels}
            onChange={(event) => updateField("labels", event.target.value)}
            placeholder="frontend, auth, api"
          />
        </label>

        <div className="field-grid">
          <label className="field">
            <span>Blocked by</span>
            <input
              data-testid="story-blocked-by-input"
              value={form.blockedBy}
              onChange={(event) => updateField("blockedBy", event.target.value)}
              placeholder="STO-001, STO-002"
            />
          </label>

          <label className="field">
            <span>Blocks</span>
            <input
              data-testid="story-blocks-input"
              value={form.blocks}
              onChange={(event) => updateField("blocks", event.target.value)}
              placeholder="STO-010, STO-011"
            />
          </label>
        </div>

        <label className="field">
          <span>Related to</span>
          <input
            data-testid="story-related-to-input"
            value={form.relatedTo}
            onChange={(event) => updateField("relatedTo", event.target.value)}
            placeholder="STO-020, STO-021"
          />
        </label>

        <label className="field">
          <span>Context files</span>
          <textarea
            data-testid="story-context-files-input"
            rows="4"
            value={form.contextFiles}
            onChange={(event) => updateField("contextFiles", event.target.value)}
            placeholder={"src/auth/google.ts\nsrc/routes/login.ts"}
          />
        </label>

        <label className="field">
          <span>Agent status note</span>
          <textarea
            data-testid="story-agent-status-note-input"
            rows="3"
            value={form.agentStatusNote}
            onChange={(event) => updateField("agentStatusNote", event.target.value)}
          />
        </label>

        <section className="editor-section">
          <div className="editor-section__header">
            <h3>Ready checklist</h3>
            <button className="ghost-button" type="button" onClick={() => addCriterion("readyCriteria")}>
              Anadir criterio
            </button>
          </div>

          <div className="criteria-editor-list">
            {form.readyCriteria.map((criterion, index) => (
              <div key={criterion.uiKey} className="criteria-editor">
                <div className="criteria-editor__grid">
                  <label className="field">
                    <span>Etiqueta</span>
                    <input
                      value={criterion.label}
                      onChange={(event) =>
                        updateCriteria("readyCriteria", index, "label", event.target.value)
                      }
                    />
                  </label>

                  <label className="field">
                    <span>Tipo</span>
                    <select
                      value={criterion.kind}
                      onChange={(event) =>
                        updateCriteria("readyCriteria", index, "kind", event.target.value)
                      }
                    >
                      <option value="manual">Manual</option>
                      <option value="derived">Derived</option>
                    </select>
                  </label>

                  {criterion.kind === "derived" ? (
                    <label className="field">
                      <span>Regla</span>
                      <select
                        value={criterion.rule}
                        onChange={(event) =>
                          updateCriteria("readyCriteria", index, "rule", event.target.value)
                        }
                      >
                        <option value="dependencies_done">Dependencies done</option>
                        <option value="all_subtasks_done">All subtasks done</option>
                        <option value="has_assignee">Has assignee</option>
                        <option value="has_agent_owner">Has agent owner</option>
                        <option value="has_context_files">Has context files</option>
                        <option value="story_in_testing">Story in testing</option>
                      </select>
                    </label>
                  ) : (
                    <label className="checkbox-field criteria-editor__checkbox">
                      <input
                        type="checkbox"
                        checked={Boolean(criterion.checked)}
                        onChange={(event) =>
                          updateCriteria("readyCriteria", index, "checked", event.target.checked)
                        }
                      />
                      <span>Cumplido</span>
                    </label>
                  )}
                </div>
                <button className="ghost-button" type="button" onClick={() => removeCriterion("readyCriteria", index)}>
                  Quitar
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="editor-section">
          <div className="editor-section__header">
            <h3>Done checklist</h3>
            <button className="ghost-button" type="button" onClick={() => addCriterion("doneCriteria")}>
              Anadir criterio
            </button>
          </div>

          <div className="criteria-editor-list">
            {form.doneCriteria.map((criterion, index) => (
              <div key={criterion.uiKey} className="criteria-editor">
                <div className="criteria-editor__grid">
                  <label className="field">
                    <span>Etiqueta</span>
                    <input
                      value={criterion.label}
                      onChange={(event) =>
                        updateCriteria("doneCriteria", index, "label", event.target.value)
                      }
                    />
                  </label>

                  <label className="field">
                    <span>Tipo</span>
                    <select
                      value={criterion.kind}
                      onChange={(event) =>
                        updateCriteria("doneCriteria", index, "kind", event.target.value)
                      }
                    >
                      <option value="manual">Manual</option>
                      <option value="derived">Derived</option>
                    </select>
                  </label>

                  {criterion.kind === "derived" ? (
                    <label className="field">
                      <span>Regla</span>
                      <select
                        value={criterion.rule}
                        onChange={(event) =>
                          updateCriteria("doneCriteria", index, "rule", event.target.value)
                        }
                      >
                        <option value="dependencies_done">Dependencies done</option>
                        <option value="all_subtasks_done">All subtasks done</option>
                        <option value="has_assignee">Has assignee</option>
                        <option value="has_agent_owner">Has agent owner</option>
                        <option value="has_context_files">Has context files</option>
                        <option value="story_in_testing">Story in testing</option>
                      </select>
                    </label>
                  ) : (
                    <label className="checkbox-field criteria-editor__checkbox">
                      <input
                        type="checkbox"
                        checked={Boolean(criterion.checked)}
                        onChange={(event) =>
                          updateCriteria("doneCriteria", index, "checked", event.target.checked)
                        }
                      />
                      <span>Cumplido</span>
                    </label>
                  )}
                </div>
                <button className="ghost-button" type="button" onClick={() => removeCriterion("doneCriteria", index)}>
                  Quitar
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="editor-section">
          <div className="editor-section__header">
            <h3>Subtareas</h3>
            <button className="ghost-button" type="button" onClick={addSubtask}>
              Anadir
            </button>
          </div>

          <div className="subtask-editor-list">
            {form.subtasks.map((subtask, index) => (
              <div key={subtask.uiKey} className="subtask-editor">
                <div className="subtask-editor__main">
                  <input
                    value={subtask.title}
                    onChange={(event) => updateSubtask(index, "title", event.target.value)}
                    placeholder="Subtarea"
                  />
                </div>
                <div className="subtask-editor__actions">
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={Boolean(subtask.done)}
                      onChange={(event) => updateSubtask(index, "done", event.target.checked)}
                    />
                    <span>Done</span>
                  </label>
                  <button className="ghost-button" type="button" onClick={() => removeSubtask(index)}>
                    Quitar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <label className="field">
          <span>Detalle Markdown</span>
          <textarea rows="9" value={form.body} onChange={(event) => updateField("body", event.target.value)} />
        </label>

        <button className="primary-button" type="submit" disabled={isSaving} data-testid="save-story-button">
          {isSaving ? "Guardando..." : story ? "Guardar cambios" : "Crear historia"}
        </button>
      </form>
    </aside>
  );
}
