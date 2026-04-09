export function toStorySlug(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function deriveStoryId(payload) {
  const explicitId = String(payload?.id ?? "").trim();
  if (explicitId) {
    return explicitId;
  }

  return `STO-${toStorySlug(payload?.title ?? "")}`;
}

export function deriveEpicId(payload) {
  const explicitId = String(payload?.id ?? "").trim();
  if (explicitId) {
    return explicitId;
  }

  return `EPI-${toStorySlug(payload?.title ?? "")}`;
}
