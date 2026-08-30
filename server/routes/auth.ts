// ---------------------------------------------------------------------------
// Auth routes — Lucid OAuth2.
//
//   GET  /api/auth/lucid          → redirect to Lucid's authorization page
//   GET  /api/auth/lucid/callback → exchange code for tokens, store server-side
//   GET  /api/auth/status         → is the user authenticated?
//
// The authorization redirect uses Lucid's real URL format; the token exchange
// is structurally correct (POST to https://lucid.app/oauth2/token) but returns
// a mock token set when no credentials are configured. See TODOs below.
// ---------------------------------------------------------------------------

import { Router } from "express";

import { isAuthenticated, storeTokens } from "../services/lucid-oauth.ts";

export const authRouter = Router();

// TODO: bind the OAuth state to a real session instead of a module variable.
let oauthState: string | null = null;

/** Lucid OAuth scopes requested for the embed editor. */
// TODO: confirm exact scope strings against https://developer.lucid.co/docs/
const LUCID_SCOPES = ["lucid.document:read", "lucid.document:write"].join(" ");

authRouter.get("/auth/lucid", (req, res) => {
  const clientId = process.env.LUCID_CLIENT_ID ?? "";
  const redirectUri =
    process.env.LUCID_REDIRECT_URI ??
    "http://localhost:3001/api/auth/lucid/callback";

  // CSRF state — validated in the callback.
  oauthState = crypto.randomUUID();

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: LUCID_SCOPES,
    state: oauthState,
  });

  // Real Lucid authorization endpoint.
  const authorizeUrl = `https://lucid.app/oauth2/authorize?${params.toString()}`;
  res.redirect(authorizeUrl);
});

authRouter.get("/auth/lucid/callback", async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";

  // Validate the CSRF state.
  if (!oauthState || state !== oauthState) {
    res.status(400).json({ error: "Invalid OAuth state" });
    return;
  }
  oauthState = null;

  if (!code) {
    res.status(400).json({ error: "Missing authorization code" });
    return;
  }

  const clientId = process.env.LUCID_CLIENT_ID ?? "";
  const clientSecret = process.env.LUCID_CLIENT_SECRET ?? "";
  const redirectUri =
    process.env.LUCID_REDIRECT_URI ??
    "http://localhost:3001/api/auth/lucid/callback";

  if (clientId && clientSecret) {
    // Real token exchange.
    try {
      const tokenRes = await fetch("https://lucid.app/oauth2/token", {
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
        res.status(502).json({ error: `Lucid token exchange failed: ${detail}` });
        return;
      }
      const tokens = (await tokenRes.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
        token_type?: string;
        scope?: string;
      };
      storeTokens({
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
  } else {
    // MOCK: no real credentials configured — store a synthetic token set so the
    // app shell treats the session as authenticated.
    // TODO: remove this branch once real credentials are in place.
    storeTokens({
      access_token: `mock-access-${Date.now().toString(36)}`,
      refresh_token: `mock-refresh-${Date.now().toString(36)}`,
      expires_at: Date.now() + 3600 * 1000,
      token_type: "bearer",
      scope: LUCID_SCOPES,
    });
  }

  // Back to the app shell.
  res.redirect("/");
});

authRouter.get("/auth/status", (_req, res) => {
  res.json({ authenticated: isAuthenticated(), session: "default" });
});
