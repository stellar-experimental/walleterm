import type { RequestState } from './types.js';

export interface RequestError extends Error {
  status?: number;
  code?: string;
  exitCode?: number;
  canceled?: boolean;
  requestState?: RequestState;
}

/** A deadline whose reason says what timed out. `AbortSignal.timeout` says only "signal timed out". */
export function deadline(milliseconds: number, message: string): AbortSignal {
  const controller = new AbortController();
  AbortSignal.timeout(milliseconds).addEventListener(
    'abort',
    () => controller.abort(Object.assign(Error(message), { name: 'TimeoutError' })),
    { once: true },
  );
  return controller.signal;
}

// JavaScript permits throwing any value. Normalize it at each catch boundary.
export function requestError(value: unknown): RequestError {
  return value instanceof Error ? value : Error(String(value));
}

/** SEP-43 codes: -1 wallet, -2 external service, -3 invalid request, -4 rejected. */
export type Sep43Code = -1 | -2 | -3 | -4;
export interface Sep43Error {
  code: Sep43Code;
  message: string;
  ext?: string[];
  requestState?: RequestState;
}
const reasons = {
  not_connected: [-3, 401],
  network_unsupported: [-3, 400],
  address_mismatch: [-3, 400],
  invalid_request: [-3, 400],
  unsupported: [-3, 400],
  conflict: [-3, 409],
  rate_limited: [-3, 429],
  expired: [-3, 409],
  rejected: [-4, 409],
  bridge_unavailable: [-2, 503],
  result_unknown: [-1, 502],
  internal: [-1, 500],
} as const satisfies Record<string, readonly [Sep43Code, number]>;
export type Sep43Reason = keyof typeof reasons;

/** A native SDK and bridge failure. `ext[0]` names the stable reason. */
export class WalletermError extends Error {
  code: Sep43Code;
  ext: string[];
  status: number;
  requestState?: RequestState;
  canceled?: boolean;
  constructor(
    reason: Sep43Reason,
    message: string,
    { status, requestState }: { status?: number; requestState?: RequestState } = {},
  ) {
    super(message);
    this.name = 'WalletermError';
    [this.code, this.status] = reasons[reason];
    if (status) this.status = status;
    this.ext = [`walleterm:${reason}`];
    if (requestState) this.requestState = requestState;
  }
}
export function walletermError(
  reason: Sep43Reason,
  message: string,
  options?: { status?: number; requestState?: RequestState },
) {
  return new WalletermError(reason, message, options);
}
const validCode = (code: unknown): code is Sep43Code =>
  code === -1 || code === -2 || code === -3 || code === -4;

/** Convert any failure to the SEP-43 error object. Unknown signing outcomes stay unknown. */
export function sep43Error(value: unknown): Sep43Error {
  const error: Omit<RequestError, 'code'> & { code?: unknown; ext?: unknown } = requestError(value);
  const state = error.requestState;
  const result = (code: Sep43Code, reason: string): Sep43Error => ({
    code,
    message: error.message || 'Walleterm could not complete the request.',
    ext:
      validCode(error.code) && Array.isArray(error.ext) && error.ext.every((v) => typeof v === 'string')
        ? [...error.ext]
        : [`walleterm:${reason}`],
    ...(state === 'denied' || state === 'expired' || state === 'unknown' ? { requestState: state } : {}),
  });
  // An unconfirmed cancellation cannot prove that signing stopped.
  if (state === 'unknown' || error.canceled === false)
    return { ...result(-1, 'result_unknown'), ext: ['walleterm:result_unknown'], requestState: 'unknown' };
  if (validCode(error.code)) return result(error.code, 'internal');
  if (error.canceled) return result(-4, 'rejected');
  if (state === 'expired') return result(-3, 'expired');
  if (state === 'denied') return result(-4, 'rejected');
  const status = error.status;
  if (status === 401) return result(-3, 'not_connected');
  if (status === 409) return result(-3, 'conflict');
  if (status === 429) return result(-3, 'rate_limited');
  if (status && status < 500) return result(-3, 'invalid_request');
  if (status || ['TypeError', 'TimeoutError'].includes(error.name)) return result(-2, 'bridge_unavailable');
  return result(-1, 'internal');
}
