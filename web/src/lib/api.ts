export interface ApiErrorDetail {
  field: string;
  message: string;
}

export class ApiError extends Error {
  status: number;
  code: string;
  details?: ApiErrorDetail[];
  /** Set when the request never reached the server. */
  offline: boolean;
  /** The parsed response body, when there was one. A rejected check-in is a
   *  409 that still carries a full result the UI needs to show. */
  body?: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: ApiErrorDetail[],
    offline = false,
    body?: unknown
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.offline = offline;
    this.body = body;
  }
}

type Body = Record<string, unknown> | undefined;

async function request<T>(method: string, path: string, body?: Body, signal?: AbortSignal) {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'network', 'Cannot reach the server', undefined, true);
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let payload: unknown = undefined;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = undefined;
    }
  }

  if (!res.ok) {
    const error = (payload as { error?: { code?: string; message?: string; details?: ApiErrorDetail[] } })
      ?.error;
    throw new ApiError(
      res.status,
      error?.code || 'request_failed',
      error?.message || `Request failed (${res.status})`,
      error?.details,
      false,
      payload
    );
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>('GET', path, undefined, signal),
  post: <T>(path: string, body?: Body) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: Body) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path)
};

/** Error text for a specific form field, when the server supplied one. */
export function fieldError(error: unknown, field: string) {
  if (!(error instanceof ApiError)) return undefined;
  return error.details?.find((detail) => detail.field === field)?.message;
}
