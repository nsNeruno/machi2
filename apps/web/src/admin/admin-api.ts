import {
  adminGamesResponseSchema,
  adminGameResponseSchema,
  adminLocationResponseSchema,
  adminLocationsResponseSchema,
  adminMeResponseSchema,
  adminQueueBoardResponseSchema,
  adminQueueStreamEventSchema,
  adminUserResponseSchema,
  adminUsersResponseSchema,
  governorStatusSchema,
  slugAvailabilityResponseSchema,
  type AdminClearQueueResponse,
  type AdminQueueStreamEvent,
  type GovernorStatus,
  type LoadLevel,
  type AdminCommunityNoteInput,
  type AdminGameCreateInput,
  type AdminGameResponse,
  type AdminGameUpdateInput,
  type AdminGrantsInput,
  type AdminLocationCreateInput,
  type AdminLocationResponse,
  type AdminLocationUpdateInput,
  type AdminMarkDoneInput,
  type AdminMeResponse,
  type AdminQueueBoardResponse,
  type AdminUserCreateInput,
  type AdminUserResponse,
  type AdminUserUpdateInput,
  type SlugAvailabilityResponse,
} from '@machi2/shared';

export class AdminApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = 'AdminApiError';
    this.status = status;
    this.code = code;
  }
}

type Schema<T> = { safeParse: (value: unknown) => { success: true; data: T } | { success: false } };

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  csrfToken?: string | null;
};

async function request<T>(
  path: string,
  schema: Schema<T> | null,
  options: RequestOptions = {},
): Promise<T> {
  const headers = new Headers({ Accept: 'application/json' });
  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  if (options.csrfToken) {
    headers.set('X-CSRF-Token', options.csrfToken);
  }

  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      credentials: 'same-origin',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new AdminApiError('Unable to reach the admin service.', 0);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const problem = payload as { code?: string; message?: string } | null;
    throw new AdminApiError(
      problem?.message ?? `Request failed (${response.status}).`,
      response.status,
      problem?.code ?? null,
    );
  }

  if (!schema) {
    return payload as T;
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new AdminApiError('The admin service returned an unexpected response.', response.status);
  }
  return parsed.data;
}

// ---- Auth ----

export function fetchMe(): Promise<AdminMeResponse> {
  return request('/api/admin/me', adminMeResponseSchema);
}

export function login(email: string, password: string): Promise<AdminMeResponse> {
  return request('/api/admin/session', adminMeResponseSchema, {
    method: 'POST',
    body: { email, password },
  });
}

export function logout(csrfToken: string): Promise<void> {
  return request('/api/admin/session', null, { method: 'DELETE', csrfToken });
}

// ---- Locations ----

export function fetchLocations(): Promise<AdminLocationResponse[]> {
  return request('/api/admin/locations', adminLocationsResponseSchema);
}

export function checkSlug(slug: string, excludeId?: string): Promise<SlugAvailabilityResponse> {
  const params = new URLSearchParams({ slug });
  if (excludeId) {
    params.set('excludeId', excludeId);
  }
  return request(`/api/admin/locations/slug-availability?${params.toString()}`, slugAvailabilityResponseSchema);
}

export function createLocation(
  input: AdminLocationCreateInput,
  csrfToken: string,
): Promise<AdminLocationResponse> {
  return request('/api/admin/locations', adminLocationResponseSchema, {
    method: 'POST',
    body: input,
    csrfToken,
  });
}

export function updateLocation(
  id: string,
  input: AdminLocationUpdateInput,
  csrfToken: string,
): Promise<AdminLocationResponse> {
  return request(`/api/admin/locations/${id}`, adminLocationResponseSchema, {
    method: 'PATCH',
    body: input,
    csrfToken,
  });
}

export function deleteLocation(id: string, csrfToken: string): Promise<void> {
  return request(`/api/admin/locations/${id}`, null, { method: 'DELETE', csrfToken });
}

// ---- Games ----

export function fetchGames(locationId: string): Promise<AdminGameResponse[]> {
  return request(`/api/admin/locations/${locationId}/games`, adminGamesResponseSchema);
}

export function createGame(
  locationId: string,
  input: AdminGameCreateInput,
  csrfToken: string,
): Promise<AdminGameResponse> {
  return request(`/api/admin/locations/${locationId}/games`, adminGameResponseSchema, {
    method: 'POST',
    body: input,
    csrfToken,
  });
}

export function updateGame(
  gameId: string,
  input: AdminGameUpdateInput,
  csrfToken: string,
): Promise<AdminGameResponse> {
  return request(`/api/admin/games/${gameId}`, adminGameResponseSchema, {
    method: 'PATCH',
    body: input,
    csrfToken,
  });
}

export function deleteGame(gameId: string, csrfToken: string): Promise<void> {
  return request(`/api/admin/games/${gameId}`, null, { method: 'DELETE', csrfToken });
}

export function reorderGames(locationId: string, order: string[], csrfToken: string): Promise<void> {
  return request(`/api/admin/locations/${locationId}/games/order`, null, {
    method: 'PUT',
    body: { order },
    csrfToken,
  });
}

export function setCommunityNote(
  gameId: string,
  input: AdminCommunityNoteInput,
  csrfToken: string,
): Promise<AdminGameResponse> {
  return request(`/api/admin/games/${gameId}/community-note`, adminGameResponseSchema, {
    method: 'PUT',
    body: input,
    csrfToken,
  });
}

// ---- Live queue ----

export function fetchAdminQueue(gameId: string): Promise<AdminQueueBoardResponse> {
  return request(`/api/admin/games/${gameId}/queue`, adminQueueBoardResponseSchema);
}

export type AdminStreamState = 'live' | 'reconnecting' | 'offline';

/** Subscribe to the admin queue SSE stream (cookie-authenticated, admin board payload). */
export function subscribeToAdminQueue(
  gameId: string,
  handlers: { onEvent: (event: AdminQueueStreamEvent) => void; onState: (state: AdminStreamState) => void },
): () => void {
  const controller = new AbortController();
  void consumeAdminStream(gameId, handlers, controller.signal);
  return () => controller.abort();
}

async function consumeAdminStream(
  gameId: string,
  handlers: { onEvent: (event: AdminQueueStreamEvent) => void; onState: (state: AdminStreamState) => void },
  signal: AbortSignal,
): Promise<void> {
  let retryDelay = 1_000;
  while (!signal.aborted) {
    handlers.onState(isOnline() ? 'reconnecting' : 'offline');
    try {
      const response = await fetch(`/api/admin/games/${gameId}/stream`, {
        headers: { Accept: 'text/event-stream' },
        credentials: 'same-origin',
        signal,
      });
      if (!response.ok || !response.body) {
        throw new AdminApiError(`Live updates unavailable (${response.status}).`, response.status);
      }
      retryDelay = 1_000;
      await readAdminStream(response.body, handlers, signal);
    } catch {
      if (signal.aborted) {
        return;
      }
      handlers.onState(isOnline() ? 'reconnecting' : 'offline');
    }
    await waitFor(retryDelay, signal);
    retryDelay = Math.min(retryDelay * 2, 15_000);
  }
}

async function readAdminStream(
  body: ReadableStream<Uint8Array>,
  handlers: { onEvent: (event: AdminQueueStreamEvent) => void; onState: (state: AdminStreamState) => void },
  signal: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (!signal.aborted) {
      const chunk = await reader.read();
      if (chunk.done) {
        return;
      }
      buffer += decoder.decode(chunk.value, { stream: true });
      const messages = buffer.split(/\r?\n\r?\n/);
      buffer = messages.pop() ?? '';
      for (const message of messages) {
        const data = message
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (!data) {
          continue;
        }
        const parsed = adminQueueStreamEventSchema.safeParse(JSON.parse(data) as unknown);
        if (parsed.success) {
          handlers.onEvent(parsed.data);
          handlers.onState('live');
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine;
}

function waitFor(delay: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const onAbort = () => {
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delay);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function markEntryDone(entryId: string, input: AdminMarkDoneInput, csrfToken: string): Promise<void> {
  return request(`/api/admin/queue-entries/${entryId}/done`, null, {
    method: 'POST',
    body: input,
    csrfToken,
  });
}

export function deleteEntry(entryId: string, csrfToken: string): Promise<void> {
  return request(`/api/admin/queue-entries/${entryId}`, null, { method: 'DELETE', csrfToken });
}

export function clearQueue(gameId: string, csrfToken: string): Promise<AdminClearQueueResponse> {
  return request(`/api/admin/games/${gameId}/queue/clear`, null, { method: 'POST', csrfToken });
}

// ---- Users ----

export function fetchUsers(): Promise<AdminUserResponse[]> {
  return request('/api/admin/users', adminUsersResponseSchema);
}

export function createUser(input: AdminUserCreateInput, csrfToken: string): Promise<AdminUserResponse> {
  return request('/api/admin/users', adminUserResponseSchema, { method: 'POST', body: input, csrfToken });
}

export function updateUser(
  id: string,
  input: AdminUserUpdateInput,
  csrfToken: string,
): Promise<AdminUserResponse> {
  return request(`/api/admin/users/${id}`, adminUserResponseSchema, {
    method: 'PATCH',
    body: input,
    csrfToken,
  });
}

export function setGrants(id: string, input: AdminGrantsInput, csrfToken: string): Promise<AdminUserResponse> {
  return request(`/api/admin/users/${id}/grants`, adminUserResponseSchema, {
    method: 'PUT',
    body: input,
    csrfToken,
  });
}

export function setUserPassword(id: string, password: string, csrfToken: string): Promise<void> {
  return request(`/api/admin/users/${id}/password`, null, {
    method: 'POST',
    body: { password },
    csrfToken,
  });
}

// ---- Maintenance / load governor (superadmin) ----

export function fetchMaintenance(): Promise<GovernorStatus> {
  return request('/api/admin/maintenance', governorStatusSchema);
}

export function setMaintenance(
  level: LoadLevel | null,
  reason: string | undefined,
  csrfToken: string,
): Promise<GovernorStatus> {
  return request('/api/admin/maintenance', governorStatusSchema, {
    method: 'POST',
    body: { level, reason },
    csrfToken,
  });
}
