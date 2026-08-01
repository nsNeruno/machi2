import {
  completeQueueEntryResponseSchema,
  enqueueResponseSchema,
  locationDetailResponseSchema,
  locationStreamEventSchema,
  locationsResponseSchema,
  queueBoardResponseSchema,
  queueStreamEventSchema,
  type CompleteQueueEntryResponse,
  type EnqueueResponse,
  type LocationDetailResponse,
  type LocationPosition,
  type LocationSummaryResponse,
  type LocationStreamEvent,
  type QueueBoardResponse,
  type QueueStreamEvent,
} from '@machi2/shared';

import { createUuid } from './uuid';

export type DeviceIdentity = {
  deviceToken: string;
  deviceProof: string | null;
  setDeviceProof: (proof: string | null) => void;
};

export type ConnectionState = 'live' | 'reconnecting' | 'offline';

type RequestOptions = {
  method?: 'GET' | 'POST';
  body?: unknown;
  idempotencyKey?: string;
};

type ApiProblem = {
  code?: string;
  details?: unknown;
  message?: string;
};

type ResponseSchema<T> = {
  safeParse: (value: unknown) => { success: true; data: T } | { success: false };
};

export class ApiError extends Error {
  readonly code: string | null;
  readonly details: unknown;
  readonly status: number | null;

  constructor(
    message: string,
    code: string | null = null,
    status: number | null = null,
    details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

async function request<T>(
  path: string,
  schema: ResponseSchema<T>,
  device: DeviceIdentity,
  options: RequestOptions = {},
  retriedAfterProofReset = false,
): Promise<T> {
  const headers = new Headers({
    Accept: 'application/json',
    'X-Device-Token': device.deviceToken,
  });

  if (device.deviceProof) {
    headers.set('X-Device-Proof', device.deviceProof);
  }
  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  if (options.idempotencyKey) {
    headers.set('Idempotency-Key', options.idempotencyKey);
  }

  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError('Unable to reach the queue service.');
  }

  const proof = response.headers.get('x-device-proof');
  if (proof) {
    device.setDeviceProof(proof);
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const problem = payload as ApiProblem | null;
    if (problem?.code === 'invalid_device_proof' && device.deviceProof && !retriedAfterProofReset) {
      device.setDeviceProof(null);
      return request(path, schema, { ...device, deviceProof: null }, options, true);
    }
    throw new ApiError(
      problem?.message ?? `Request failed (${response.status}).`,
      problem?.code ?? null,
      response.status,
      problem?.details,
    );
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError('The queue service returned an unexpected response.');
  }
  return parsed.data;
}

export function fetchLocations(device: DeviceIdentity): Promise<LocationSummaryResponse[]> {
  return request('/api/locations', locationsResponseSchema, device);
}

export function fetchLocation(
  slug: string,
  device: DeviceIdentity,
): Promise<LocationDetailResponse> {
  return request(
    `/api/locations/${encodeURIComponent(slug)}`,
    locationDetailResponseSchema,
    device,
  );
}

export function fetchQueueBoard(
  gameId: string,
  device: DeviceIdentity,
): Promise<QueueBoardResponse> {
  return request(
    `/api/games/${encodeURIComponent(gameId)}/queue?scope=all`,
    queueBoardResponseSchema,
    device,
  );
}

export function enqueueGame(
  gameId: string,
  input: { displayName: string; autoRequeue: boolean; position?: LocationPosition },
  device: DeviceIdentity,
): Promise<EnqueueResponse> {
  return request(`/api/games/${encodeURIComponent(gameId)}/queue`, enqueueResponseSchema, device, {
    method: 'POST',
    body: input,
    idempotencyKey: createUuid(),
  });
}

export function completeQueueEntry(
  entryId: string,
  input: {
    reason: 'played' | 'left' | 'skipped' | 'other';
    actingName: string;
    staffPin?: string;
    position?: LocationPosition;
  },
  device: DeviceIdentity,
): Promise<CompleteQueueEntryResponse> {
  return request(
    `/api/queue-entries/${encodeURIComponent(entryId)}/done`,
    completeQueueEntryResponseSchema,
    device,
    {
      method: 'POST',
      body: input,
      idempotencyKey: createUuid(),
    },
  );
}

type StreamHandlers<T> = {
  onEvent: (event: T) => void;
  onState: (state: ConnectionState) => void;
};

export function subscribeToQueueStream(
  gameId: string,
  device: DeviceIdentity,
  handlers: StreamHandlers<QueueStreamEvent>,
): () => void {
  return subscribeToStream(
    `/api/games/${encodeURIComponent(gameId)}/stream`,
    queueStreamEventSchema,
    device,
    handlers,
  );
}

export function subscribeToLocationStream(
  slug: string,
  device: DeviceIdentity,
  handlers: StreamHandlers<LocationStreamEvent>,
): () => void {
  return subscribeToStream(
    `/api/locations/${encodeURIComponent(slug)}/stream`,
    locationStreamEventSchema,
    device,
    handlers,
  );
}

function subscribeToStream<T>(
  path: string,
  schema: ResponseSchema<T>,
  device: DeviceIdentity,
  handlers: StreamHandlers<T>,
): () => void {
  const controller = new AbortController();
  void consumeStream(path, schema, device, handlers, controller.signal);
  return () => controller.abort();
}

async function consumeStream<T>(
  path: string,
  schema: ResponseSchema<T>,
  device: DeviceIdentity,
  handlers: StreamHandlers<T>,
  signal: AbortSignal,
): Promise<void> {
  let retryDelay = 1_000;

  while (!signal.aborted) {
    handlers.onState(isOnline() ? 'reconnecting' : 'offline');

    try {
      const headers = new Headers({
        Accept: 'text/event-stream',
        'X-Device-Token': device.deviceToken,
      });
      if (device.deviceProof) {
        headers.set('X-Device-Proof', device.deviceProof);
      }

      const response = await fetch(path, { headers, signal });
      const proof = response.headers.get('x-device-proof');
      if (proof) {
        device.setDeviceProof(proof);
      }
      if (!response.ok || !response.body) {
        throw new ApiError(`Live updates are unavailable (${response.status}).`);
      }

      retryDelay = 1_000;
      await readStream(response.body, schema, handlers, signal);
    } catch {
      if (signal.aborted) {
        return;
      }
      handlers.onState(isOnline() ? 'reconnecting' : 'offline');
    }

    await waitForRetry(retryDelay, signal);
    retryDelay = Math.min(retryDelay * 2, 15_000);
  }
}

async function readStream<T>(
  body: ReadableStream<Uint8Array>,
  schema: ResponseSchema<T>,
  handlers: StreamHandlers<T>,
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

        const parsed = schema.safeParse(JSON.parse(data) as unknown);
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

function waitForRetry(delay: number, signal: AbortSignal): Promise<void> {
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
