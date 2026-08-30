// ---------------------------------------------------------------------------
// Session helpers — issue and read an httpOnly session cookie.
//
// The backend keeps Lucid OAuth tokens in memory keyed by session id (see
// lucid-oauth.ts). The session id is carried in an httpOnly cookie so the
// browser exposes it to the backend on every /api request but never to
// frontend JavaScript. This replaces the old single-module-level "default"
// token entry so concurrent auth flows don't share or overwrite each other.
// ---------------------------------------------------------------------------

import type { Request, Response } from "express";

const SESSION_COOKIE = "arch_studio_sid";
const SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Read the session id from the incoming request's Cookie header. */
export function getSessionId(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    if (key === SESSION_COOKIE) {
      const value = trimmed.slice(eq + 1);
      if (value) return value;
    }
  }
  return undefined;
}

/** Issue a fresh session id (set as an httpOnly cookie) and return it. */
export function issueSession(res: Response): string {
  const sid = crypto.randomUUID();
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });
  return sid;
}
