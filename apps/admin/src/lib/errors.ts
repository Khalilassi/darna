import { ApiError } from "@darna/api-client";

/** Human-readable message for a failed API call, including the stable error code when present. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return `You don't have permission for this action (${err.code}).`;
    if (err.status === 422 && err.code === "http_error") return "The request was rejected as invalid (validation_error).";
    return `${err.message} (${err.code})`;
  }
  if (err instanceof TypeError) return "Could not reach the Darna API. Check your connection and try again.";
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}

export function isForbidden(err: unknown): boolean {
  return err instanceof ApiError && err.status === 403;
}
