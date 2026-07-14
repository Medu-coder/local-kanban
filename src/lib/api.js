class ApiError extends Error {
  constructor(message, { status, code, details, payload } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status ?? null;
    this.code = code ?? null;
    this.details = details ?? null;
    this.payload = payload ?? null;
  }
}

export function createIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `ui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function withMutationMetadata(payload = {}, metadata = {}) {
  return {
    ...payload,
    ...metadata,
    idempotencyKey: metadata.idempotencyKey ?? payload.idempotencyKey ?? createIdempotencyKey(),
  };
}

function mutationHeaders(payload) {
  return {
    "Content-Type": "application/json",
    "Idempotency-Key": payload.idempotencyKey,
  };
}

async function handleJson(response, fallback) {
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const base = payload.message ?? payload.detail ?? payload.error ?? fallback;
    const nextAction = payload.details?.nextAction;
    const command = payload.details?.command;
    const message = [base, nextAction, command ? `Comando: ${command}` : null].filter(Boolean).join(" ");
    throw new ApiError(message, {
      status: response.status,
      code: payload.code ?? (response.status === 409 ? "conflict" : "request_failed"),
      details: payload.details,
      payload,
    });
  }

  return response.json();
}

export async function fetchProjects() {
  const response = await fetch("/api/projects");
  return handleJson(response, "No se pudieron cargar los proyectos.");
}

export async function moveStory(projectId, storyId, payload) {
  const body = withMutationMetadata(payload);
  const response = await fetch(`/api/projects/${projectId}/stories/${storyId}/move`, {
    method: "POST",
    headers: mutationHeaders(body),
    body: JSON.stringify(body),
  });

  return handleJson(response, "No se pudo mover la historia.");
}

export async function createStory(projectId, payload, metadata = {}) {
  const body = withMutationMetadata(payload, metadata);
  const response = await fetch(`/api/projects/${projectId}/stories`, {
    method: "POST",
    headers: mutationHeaders(body),
    body: JSON.stringify(body),
  });

  return handleJson(response, "No se pudo crear la historia.");
}

export async function saveStory(projectId, storyId, payload, metadata = {}) {
  const body = withMutationMetadata(payload, metadata);
  const response = await fetch(`/api/projects/${projectId}/stories/${storyId}`, {
    method: "PUT",
    headers: mutationHeaders(body),
    body: JSON.stringify(body),
  });

  return handleJson(response, "No se pudo guardar la historia.");
}

export async function toggleStorySubtask(projectId, storyId, subtaskIndex, metadata = {}) {
  const body = withMutationMetadata({}, metadata);
  const response = await fetch(
    `/api/projects/${projectId}/stories/${storyId}/subtasks/${subtaskIndex}/toggle`,
    {
      method: "POST",
      headers: mutationHeaders(body),
      body: JSON.stringify(body),
    }
  );

  return handleJson(response, "No se pudo actualizar la subtarea.");
}

export async function toggleStoryCriterion(projectId, storyId, criteriaType, criteriaIndex, metadata = {}) {
  const body = withMutationMetadata({}, metadata);
  const response = await fetch(
    `/api/projects/${projectId}/stories/${storyId}/criteria/${criteriaType}/${criteriaIndex}/toggle`,
    {
      method: "POST",
      headers: mutationHeaders(body),
      body: JSON.stringify(body),
    }
  );

  return handleJson(response, "No se pudo actualizar el checklist.");
}

export async function createEpic(projectId, payload, metadata = {}) {
  const body = withMutationMetadata(payload, metadata);
  const response = await fetch(`/api/projects/${projectId}/epics`, {
    method: "POST",
    headers: mutationHeaders(body),
    body: JSON.stringify(body),
  });

  return handleJson(response, "No se pudo crear la epica.");
}

export async function saveEpic(projectId, epicId, payload, metadata = {}) {
  const body = withMutationMetadata(payload, metadata);
  const response = await fetch(`/api/projects/${projectId}/epics/${epicId}`, {
    method: "PUT",
    headers: mutationHeaders(body),
    body: JSON.stringify(body),
  });

  return handleJson(response, "No se pudo guardar la epica.");
}

export async function fetchStoryTimeline(projectId, storyId) {
  const response = await fetch(`/api/projects/${projectId}/stories/${storyId}/timeline`);
  return handleJson(response, "No se pudo cargar el timeline.");
}

export async function releaseStoryClaim(projectId, storyId, payload) {
  const response = await fetch(`/api/projects/${projectId}/stories/${storyId}/coordination/release`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleJson(response, "No se pudo liberar el claim.");
}

export async function resolveStoryBlock(projectId, storyId, blockId, payload) {
  const response = await fetch(`/api/projects/${projectId}/stories/${storyId}/blocks/${blockId}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleJson(response, "No se pudo resolver el bloqueo.");
}
