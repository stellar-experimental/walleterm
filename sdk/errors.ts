import type { RequestState } from './types.js';

export interface RequestError extends Error {
  status?: number;
  code?: string;
  exitCode?: number;
  canceled?: boolean;
  requestState?: RequestState;
}

// JavaScript permits throwing any value. Normalize it at each catch boundary.
export function requestError(value: unknown): RequestError {
  return value instanceof Error ? value : Error(String(value));
}
