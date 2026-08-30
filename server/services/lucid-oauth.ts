// ---------------------------------------------------------------------------
// Lucid OAuth token storage + refresh.
//
// Tokens are kept in memory, keyed per session id (issued as an httpOnly
// cookie by the auth routes — see session.ts). The OAuth state used for CSRF
// protection is also stored per-request in a Map so concurrent logins don't
// overwrite each other.
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

// Per-request OAuth state values: state → createdAt. Each auth request gets
// its own random state so concurrent logins don't clobber each other.
const oauthStates = new Map<string, number>();
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** Whether real Lucid credentials are configured (mock mode otherwise). */
export function isMockMode(): boolean {
  return !process.env.LUCID_CLIENT_ID || !process.env.LUCID_CLIENT_SECRET;
}

/** Generate and remember a per-request OAuth state value. */
export function createOAuthState(): string {
  pruneExpiredStates();
  const state = crypto.randomUUID();
  oauthStates.set(state, Date.now());
  return state;
}

/**
 * Validate and consume a state value from the OAuth callback.
 * Returns true iff the state was previously issued and is still fresh.
 */
export function consumeOAuthState(state: string): boolean {
  const createdAt = oauthStates.get(state);
  if (createdAt === undefined) return false;
  oauthStates.delete(state);
  return Date.now() - createdAt < STATE_TTL_MS;
}

/** Remove expired state entries to bound the map size. */
function pruneExpiredStates(): void {
  const now = Date.now();
  for (const [state, createdAt] of oauthStates) {
    if (now - createdAt >= STATE_TTL_MS) oauthStates.delete(state);
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
