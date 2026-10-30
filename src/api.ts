export async function request<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
  method?: string,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: { "Content-Type": "application/json", "X-Exql-Client": "1" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal,
  });
  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: `Request failed (${response.status})` }));
    throw new Error(error.error ?? "Request failed");
  }
  return response.status === 204
    ? (undefined as T)
    : (response.json() as Promise<T>);
}
async function exportResponse(
  path: string,
  body: unknown,
  signal: AbortSignal,
) {
  const response = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Exql-Client": "1" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok)
    throw new Error((await response.json()).error ?? "Export failed");
  return response;
}
export async function exportText(
  path: string,
  body: unknown,
  signal: AbortSignal,
) {
  return (await exportResponse(path, body, signal)).text();
}
export async function download(
  path: string,
  body: unknown,
  name: string,
  signal: AbortSignal,
) {
  const response = await exportResponse(path, body, signal);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
