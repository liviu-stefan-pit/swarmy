const secretFieldNames = new Set(["apikey", "token", "secret", "password", "authorization"]);

// Exact field names from decision D10. An id such as headerSecretId stays.
export function stripSecretFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripSecretFields(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const next: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (secretFieldNames.has(key.toLowerCase())) {
      continue;
    }
    next[key] = stripSecretFields(nested);
  }
  return next;
}
