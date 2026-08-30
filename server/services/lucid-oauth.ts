// ---------------------------------------------------------------------------
// Lucid OAuth token storage + refresh.
//
// Tokens are kept in memory, keyed per session id (issued as an httpOnly
// cookie by the auth routes — see session.ts). The OAuth state used for CSRF
// protection is bound to that session id: /auth/lucid issues the session
// cookie and stores the random state against it, then the callback verifies
// the state Lucid returns matches the state stored for the session cookie
// presented by the browser (see consumeOAuthState).
//
// When LUCID_CLIENT_ID / LUCID_CLIENT_SECRET are not configured the backend
// operates in "mock mode": synthetic tokens are stored and never truly
// refreshed, so the app shell is exercisable without real credentials.
// ---------------------------------------------------------------------------

/** A stored Lucid OAuth token set. */
export interface TokenSet {
  access_token: string;
  refresh_token?: string;
  /** Epoch ms at which the access token expires. */
  expires_at: number;
  token_type?: string;
  scope?: string;
}

/** Lucid OAuth token endpoint (used for both exchange and refresh). */
const LUCID_TOKEN_URL = "https://api.lucid.co/oauth2/token";

// Per-session token storage: sessionId → TokenSet.
const tokensBySession = new Map<string, TokenSet>();

// OAuth state bound to the browser session that initiated the auth flow:
// sessionId → { state, createdAt }. The session id is issued as an httpOnly
// cookie at /auth/lucid *before* the redirect to Lucid, so the state is
// provably tied to the browser that started the login. On the callback we
// verify the state returned by Lucid matches the state stored for the
// session cookie presented by that same browser. This prevents a stolen
// state value from being replayed in a different browser.
const oauthStates = new Map<string, { state: string; createdAt: number }>();
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** Whether real Lucid credentials are configured (mock mode otherwise). */
export function isMockMode(): boolean {
  return !process.env.LUCID_CLIENT_ID || !process.env.LUCID_CLIENT_SECRET;
}

/**
 * Generate and remember a per-session OAuth state value. The session id must
 * be the one issued (as an httpOnly cookie) at /auth/lucid before redirecting
 * to Lucid, so the state is bound to that browser session.
 */
export function createOAuthState(sessionId: string): string {
  pruneExpiredStates();
  const state = crypto.randomUUID();
  oauthStates.set(sessionId, { state, createdAt: Date.now() });
  return state;
}

/**
 * Validate and consume the OAuth state for a session. Returns true iff a
 * state was previously issued for this session, it matches the state Lucid
 * returned, and it is still fresh. The state entry is consumed on success.
 */
export function consumeOAuthState(sessionId: string, state: string): boolean {
  const entry = oauthStates.get(sessionId);
  if (!entry) return false;
  oauthStates.delete(sessionId);
  return entry.state === state && Date.now() - entry.createdAt < STATE_TTL_MS;
}

/** Remove expired state entries to bound the map size. */
function pruneExpiredStates(): void {
  const now = Date.now();
  for (const [sessionId, entry] of oauthStates) {
    if (now - entry.createdAt >= STATE_TTL_MS) oauthStates.delete(sessionId);
  }
}

export function storeTokens(sessionId: string, set: TokenSet): void {
  tokensBySession.set(sessionId, set);
}

export function getTokens(
  sessionId: string | undefined,
): TokenSet | undefined {
  if (!sessionId) return undefined;
  return tokensBySession.get(sessionId);
}

/**
 * Whether the session has a usable token.
 *
 * In real mode a session is authenticated if the access token is still valid
 * OR a refresh token is available to renew it. An expired token with no
 * refresh token is treated as unauthenticated. In mock mode any stored token
 * set counts as authenticated.
 */
export function isAuthenticated(sessionId: string | undefined): boolean {
  const set = getTokens(sessionId);
  if (!set) return false;
  if (isMockMode()) return true;
  return Date.now() < set.expires_at || !!set.refresh_token;
}

export function clearTokens(sessionId: string): void {
  tokensBySession.delete(sessionId);
}

/**
 * Returns a valid access token for the session, refreshing it via Lucid's
 * token endpoint when it has expired. In mock mode the stored (synthetic)
 * token is returned as-is. Returns undefined when the session is unknown or
 * the refresh failed.
 */
export async function getValidAccessToken(
  sessionId: string | undefined,
): Promise<string | undefined> {
  if (!sessionId) return undefined;
  const current = tokensBySession.get(sessionId);
  if (!current) return undefined;

  // Mock mode: no real token endpoint to refresh against.
  if (isMockMode()) return current.access_token;

  if (Date.now() < current.expires_at) return current.access_token;

  if (!current.refresh_token) {
    clearTokens(sessionId);
    return undefined;
  }

  return refreshAccessToken(sessionId, current);
}

/** Exchange a refresh token for a fresh access token. */
async function refreshAccessToken(
  sessionId: string,
  current: TokenSet,
): Promise<string | undefined> {
  if (!current.refresh_token) {
    clearTokens(sessionId);
    return undefined;
  }
  try {
    const res = await fetch(LUCID_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: current.refresh_token,
        client_id: process.env.LUCID_CLIENT_ID ?? "",
        client_secret: process.env.LUCID_CLIENT_SECRET ?? "",
      }),
    });
    if (!res.ok) {
      // Refresh failed — drop the session so the user re-authenticates.
      clearTokens(sessionId);
      return undefined;
    }
    const refreshed = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      token_type?: string;
      scope?: string;
    };
    const updated: TokenSet = {
      access_token: refreshed.access_token,
      // Some providers omit refresh_token on refresh; keep the old one.
      refresh_token: refreshed.refresh_token ?? current.refresh_token,
      expires_at: Date.now() + (refreshed.expires_in ?? 3600) * 1000,
      token_type: refreshed.token_type,
      scope: refreshed.scope,
    };
    storeTokens(sessionId, updated);
    return updated.access_token;
  } catch {
    clearTokens(sessionId);
    return undefined;
  }
}
