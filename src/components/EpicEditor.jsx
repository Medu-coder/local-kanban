import { useEffect, useState } from "react";

function makeInitialState(project, epic) {
  if (epic) {
    return {
      id: epic.id ?? "",
      title: epic.title ?? "",
      description: epic.description ?? "",
      labels: Array.isArray(epic.labels) ? epic.labels.join(", ") : "",
      body: epic.body ?? "",
    };
  }

  return {
    id: "",
    title: "",
    description: "",
    labels: "",
    body: "",
  };
}

function normalizeState(project, epic, form) {
  const base = form ?? makeInitialState(project, epic);
  return {
    id: base.id.trim(),
    title: base.title.trim(),
    description: base.description.trim(),
    labels: base.labels
      .split(",")
      .map((label) => label.trim())
      .filter(Boolean)
      .join(","),
    body: base.body.trim(),
  };
}

export function EpicEditor({ project, epic, onClose, onSubmit, isSaving, onDirtyChange }) {
  const [form, setForm] = useState(() => makeInitialState(project, epic));

  useEffect(() => {
    setForm(makeInitialState(project, epic));
  }, [project, epic]);

  useEffect(() => {
    const initialState = normalizeState(project, epic);
    const currentState = normalizeState(project, epic, form);
    onDirtyChange?.(JSON.stringify(initialState) !== JSON.stringify(currentState));
  }, [epic, form, onDirtyChange, project]);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    onSubmit({
      id: form.id.trim() || undefined,
      title: form.title,
      description: form.description,
      labels: form.labels
        .split(",")
        .map((label) => label.trim())
        .filter(Boolean),
      body: form.body,
    });
  }

  return (
    <aside className="editor-panel" onClick={(event) => event.stopPropagation()} data-testid="epic-editor-panel">
      <div className="detail-panel__header">
        <div>
          <p className="eyebrow">{epic ? "Editar" : "Nueva"}</p>
          <h2>{epic ? epic.title : "Épica"}</h2>
        </div>
        <button className="ghost-button" type="button" onClick={onClose} data-testid="close-epic-editor-button">
          Cerrar
        </button>
      </div>

      <form className="editor-form" onSubmit={handleSubmit}>
        <label className="field">
          <span>ID</span>
          <input
            data-testid="epic-id-input"
            value={form.id}
            onChange={(event) => updateField("id", event.target.value)}
            disabled={Boolean(epic)}
            placeholder="EPI-001 o vacio para autogenerar"
          />
        </label>

        <label className="field">
          <span>Titulo</span>
          <input
            data-testid="epic-title-input"
            value={form.title}
            onChange={(event) => updateField("title", event.target.value)}
            required
          />
        </label>

        <label className="field">
          <span>Descripcion</span>
          <textarea
            data-testid="epic-description-input"
            rows="3"
            value={form.description}
            onChange={(event) => updateField("description", event.target.value)}
          />
        </label>

        <label className="field">
          <span>Labels</span>
          <input
            data-testid="epic-labels-input"
            value={form.labels}
            onChange={(event) => updateField("labels", event.target.value)}
            placeholder="planning, auth, backend"
          />
        </label>

        <label className="field">
          <span>Detalle Markdown</span>
          <textarea
            data-testid="epic-body-input"
            rows="10"
            value={form.body}
            onChange={(event) => updateField("body", event.target.value)}
          />
        </label>

        <button className="primary-button" type="submit" disabled={isSaving} data-testid="save-epic-button">
          {isSaving ? "Guardando..." : epic ? "Guardar épica" : "Crear épica"}
        </button>
      </form>
    </aside>
  );
}
