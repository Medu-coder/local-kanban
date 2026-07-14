export async function fetchProjects() {
  const response = await fetch("/api/projects");
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail ?? payload.error ?? "No se pudieron cargar los proyectos.");
  }

  return response.json();
}

export class ApiError extends Error {
  constructor(message, { status, code, details, payload } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status ?? null;
    this.code = code ?? null;
    this.details = details ?? null;
    this.payload = payload ?? null;
  }
}

export async function updateStoryStatus(projectId, storyId, status, metadata = {}) {
  const response = await fetch(`/api/projects/${projectId}/stories/${storyId}/status`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status, ...metadata }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail ?? payload.error ?? "No se pudo actualizar la historia.");
  }

  return response.json();
}

export async function moveStory(projectId, storyId, payload) {
  const response = await fetch(`/api/projects/${projectId}/stories/${storyId}/move`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return handleJson(response, "No se pudo mover la historia.");
}

async function handleJson(response, fallback) {
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new ApiError(payload.message ?? payload.detail ?? payload.error ?? fallback, {
      status: response.status,
      code: payload.code ?? (response.status === 409 ? "conflict" : "request_failed"),
      details: payload.details,
      payload,
    });
  }

  return response.json();
}

export async function createStory(projectId, payload) {
  const response = await fetch(`/api/projects/${projectId}/stories`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return handleJson(response, "No se pudo crear la historia.");
}

export async function saveStory(projectId, storyId, payload) {
  const response = await fetch(`/api/projects/${projectId}/stories/${storyId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return handleJson(response, "No se pudo guardar la historia.");
}

export async function toggleStorySubtask(projectId, storyId, subtaskIndex) {
  const response = await fetch(
    `/api/projects/${projectId}/stories/${storyId}/subtasks/${subtaskIndex}/toggle`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    }
  );

  return handleJson(response, "No se pudo actualizar la subtarea.");
}

export async function toggleStoryCriterion(projectId, storyId, criteriaType, criteriaIndex) {
  const response = await fetch(
    `/api/projects/${projectId}/stories/${storyId}/criteria/${criteriaType}/${criteriaIndex}/toggle`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    }
  );

  return handleJson(response, "No se pudo actualizar el checklist.");
}

export async function createEpic(projectId, payload) {
  const response = await fetch(`/api/projects/${projectId}/epics`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return handleJson(response, "No se pudo crear la epica.");
}

export async function saveEpic(projectId, epicId, payload) {
  const response = await fetch(`/api/projects/${projectId}/epics/${epicId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return handleJson(response, "No se pudo guardar la epica.");
}
