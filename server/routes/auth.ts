// ---------------------------------------------------------------------------
// Auth routes — Lucid OAuth2.
//
//   GET  /api/auth/lucid          → redirect to Lucid's authorization page
//   GET  /api/auth/lucid/callback → exchange code for tokens, store server-side
//   GET  /api/auth/status         → is the user authenticated?
//
// Token exchange targets https://api.lucid.co/oauth2/token. Tokens are stored
// per-session (httpOnly cookie) so concurrent logins don't share state, and the
// OAuth state is generated per-request and validated on the callback. When
// LUCID_CLIENT_ID is not configured the backend enters mock mode: the auth
// endpoint issues a synthetic token set so the UI is exercisable without real
// credentials (a warning is logged).
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

/** Lucid OAuth scopes (verified against Lucid developer docs). */
const LUCID_SCOPES =
  "offline_access documents:read documents:write documents:create users:read";

/** Lucid OAuth authorization endpoint. */
const LUCID_AUTHORIZE_URL = "https://lucid.app/oauth2/authorize";
/** Lucid OAuth token endpoint (exchange + refresh). */
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

  // Real OAuth: generate a per-request CSRF state.
  const state = createOAuthState();
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

  // Validate the per-request CSRF state.
  if (!state || !consumeOAuthState(state)) {
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
    const sid = issueSession(res);
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
