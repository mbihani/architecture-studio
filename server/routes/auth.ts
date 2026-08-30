// ---------------------------------------------------------------------------
// Auth routes — Lucid OAuth2.
//
//   GET  /api/auth/lucid          → redirect to Lucid's authorization page
//   GET  /api/auth/lucid/callback → exchange code for tokens, store server-side
//   GET  /api/auth/status         → is the user authenticated?
//
// Token exchange targets https://api.lucid.co/oauth2/token. Tokens are stored
// per-session (httpOnly cookie) so concurrent logins don't share state. The
// OAuth state is bound to the browser session: /auth/lucid issues the session
// cookie and stores the random state against it, then the callback verifies
// the state Lucid returns matches the state stored for the session cookie
// presented by that same browser (proving the callback belongs to the browser
// that started the login). When LUCID_CLIENT_ID is not configured the backend
// enters mock mode: the auth endpoint issues a synthetic token set so the UI
// is exercisable without real credentials (a warning is logged).
// ---------------------------------------------------------------------------

import { Router } from "express";

import {
  consumeOAuthState,
  createOAuthState,
  isAuthenticated,
  storeTokens,
} from "../services/lucid-oauth.ts";
import { getSessionId, issueSession } from "../services/session.ts";

export const authRouter = Router();

/** Frontend origin to redirect to after the OAuth callback completes. */
const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:5173";

/**
 * Lucid OAuth scopes (verified against Lucid's access-scopes reference).
 * Lucid uses dot-notation scopes, not the legacy `documents:read/write`
 * names. These grant: token refresh, full create/read/edit on the user's
 * Lucidchart documents (create + list + read contents + export), and embed
 * session tokens for the embed API.
 *
 * Ref: https://lucid.readme.io/reference/access-scopes
 */
const LUCID_SCOPES = [
  "offline_access", // refresh tokens (required to renew access off-session)
  "lucidchart.document.content", // create/view/edit Lucidchart documents
  "lucidchart.document.app.picker.share.embed", // generate embed session tokens
].join(" ");

/** Lucid OAuth authorization endpoint. Ref: https://lucid.readme.io/reference/authorization-endpoints */
const LUCID_AUTHORIZE_URL = "https://lucid.app/oauth2/authorize";
/** Lucid OAuth token endpoint (exchange + refresh). Ref: https://lucid.readme.io/reference/obtaining-an-access-token */
const LUCID_TOKEN_URL = "https://api.lucid.co/oauth2/token";

/** Default callback URL (used when LUCID_REDIRECT_URI is unset). */
const DEFAULT_REDIRECT_URI = "http://localhost:3001/api/auth/lucid/callback";

authRouter.get("/auth/lucid", (_req, res) => {
  const clientId = process.env.LUCID_CLIENT_ID;
  const clientSecret = process.env.LUCID_CLIENT_SECRET;

  // Mock mode: no real credentials. Issue a synthetic session so the app shell
  // is fully exercisable end-to-end without real Lucid credentials.
  if (!clientId || !clientSecret) {
    console.warn(
      "[auth] LUCID_CLIENT_ID / LUCID_CLIENT_SECRET not set — mock mode. " +
        "Configure these env vars (see server/.env.example) to use real Lucid OAuth.",
    );
    const sid = issueSession(res);
    storeTokens(sid, {
      access_token: `mock-access-${Date.now().toString(36)}`,
      refresh_token: `mock-refresh-${Date.now().toString(36)}`,
      expires_at: Date.now() + 24 * 60 * 60 * 1000,
      token_type: "bearer",
      scope: LUCID_SCOPES,
    });
    res.redirect(FRONTEND_URL);
    return;
  }

  // Real OAuth: issue the session cookie FIRST so the CSRF state can be bound
  // to this browser session. The same cookie travels with the callback
  // redirect (sameSite=lax allows top-level GET navigations), letting us
  // verify the state belongs to the browser that initiated the login.
  const sid = issueSession(res);
  const state = createOAuthState(sid);
  const redirectUri = process.env.LUCID_REDIRECT_URI ?? DEFAULT_REDIRECT_URI;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: LUCID_SCOPES,
    state,
  });
  res.redirect(`${LUCID_AUTHORIZE_URL}?${params.toString()}`);
});

authRouter.get("/auth/lucid/callback", async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";

  // The session cookie was issued at /auth/lucid; verify the state Lucid
  // returned matches the state stored for THIS browser session. This proves
  // the callback belongs to the browser that initiated the auth flow.
  const sid = getSessionId(req);
  if (!sid || !state || !consumeOAuthState(sid, state)) {
    res.status(400).json({ error: "Invalid or expired OAuth state" });
    return;
  }

  if (!code) {
    res.status(400).json({ error: "Missing authorization code" });
    return;
  }

  const clientId = process.env.LUCID_CLIENT_ID;
  const clientSecret = process.env.LUCID_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    res.status(500).json({ error: "Lucid credentials not configured" });
    return;
  }

  const redirectUri = process.env.LUCID_REDIRECT_URI ?? DEFAULT_REDIRECT_URI;

  try {
    const tokenRes = await fetch(LUCID_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    if (!tokenRes.ok) {
      const detail = await tokenRes.text();
      res
        .status(502)
        .json({ error: `Lucid token exchange failed: ${detail}` });
      return;
    }
    const tokens = (await tokenRes.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      token_type?: string;
      scope?: string;
    };
    // Reuse the session issued at /auth/lucid (do not issue a new one): the
    // state was bound to it, and the browser already holds its cookie.
    storeTokens(sid, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      token_type: tokens.token_type,
      scope: tokens.scope,
    });
  } catch (err) {
    res
      .status(502)
      .json({ error: `Lucid token exchange error: ${(err as Error).message}` });
    return;
  }

  // Redirect back to the frontend origin (the backend has no UI of its own).
  res.redirect(FRONTEND_URL);
});

authRouter.get("/auth/status", (req, res) => {
  const sid = getSessionId(req);
  res.json({ authenticated: isAuthenticated(sid), session: sid ?? "none" });
});
