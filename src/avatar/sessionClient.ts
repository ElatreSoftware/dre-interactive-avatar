import { GRANT_HEADER } from "@/embed/grantHeader";
import type { AvatarConfig, SessionCredentials } from "./types";

export const DEFAULT_SESSION_ENDPOINT = "/api/avatar/session";

/** Thrown when the session route refuses or fails. */
export class SessionTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionTokenError";
  }
}

/**
 * Asks our own backend for a session token. Deliberately thin: the server
 * holds every secret, so there is nothing to configure here.
 */
export async function fetchSessionCredentials(
  config: AvatarConfig,
  signal?: AbortSignal,
): Promise<SessionCredentials> {
  const endpoint = config.sessionEndpoint ?? DEFAULT_SESSION_ENDPOINT;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Absent only for a host app that has not adopted embed grants.
      ...(config.grant ? { [GRANT_HEADER]: config.grant } : {}),
    },
    body: JSON.stringify({
      avatarId: config.avatarId,
      isSandbox: config.isSandbox ?? false,
      ...(config.embedKey ? { embedKey: config.embedKey } : {}),
      ...(config.dynamicVariables ? { dynamicVariables: config.dynamicVariables } : {}),
    }),
    signal,
  });

  if (!response.ok) {
    throw new SessionTokenError(`Session token request failed (${response.status})`);
  }

  const payload: unknown = await response.json().catch(() => null);
  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof (payload as Record<string, unknown>).sessionToken !== "string" ||
    typeof (payload as Record<string, unknown>).sessionId !== "string"
  ) {
    throw new SessionTokenError("Session token response was malformed");
  }

  const { sessionId, sessionToken } = payload as SessionCredentials;
  return { sessionId, sessionToken };
}
