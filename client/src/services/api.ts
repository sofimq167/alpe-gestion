// Cliente HTTP de la API. Las sesiones viajan en una cookie httpOnly (mismo dominio).

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public warnings: string[] = [],
  ) {
    super(message);
  }
  get needsConfirmation() {
    return this.code === 'REQUIERE_CONFIRMACION';
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

async function request<T>(method: Method, url: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`/api${url}`, {
      method,
      credentials: 'same-origin',
      headers: body && !isForm ? { 'Content-Type': 'application/json' } : undefined,
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('No hay conexión con el servidor. Si la aplicación estaba inactiva, espere unos segundos y reintente.', 0);
  }
  const data = res.headers.get('content-type')?.includes('application/json') ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/auth/')) window.dispatchEvent(new Event('alpe:session-expired'));
    throw new ApiError(data?.error ?? `Error ${res.status}`, res.status, data?.code, data?.details?.warnings ?? []);
  }
  return data as T;
}

export const api = {
  get: <T = any>(url: string) => request<T>('GET', url),
  post: <T = any>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T = any>(url: string, body?: unknown) => request<T>('PUT', url, body ?? {}),
  del: <T = any>(url: string) => request<T>('DELETE', url),
  upload: <T = any>(url: string, form: FormData) => request<T>('POST', url, form),
};

/** Construye una query string ignorando valores vacíos. */
export function qs(params: Record<string, string | number | undefined | null | boolean>) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false);
  if (!entries.length) return '';
  return '?' + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
}
