// ---------------------------------------------------------------------------
// Lucid OAuth token storage + refresh.
//
// Tokens are kept in memory (single-user demo). For production this should be
// persisted per session (DB / signed cookie) — see TODOs below.
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

// TODO: persist tokens per authenticated session instead of a single in-memory
// map keyed by a synthetic session id.
const SESSION_KEY = "default";
const tokens = new Map<string, TokenSet>();

export function storeTokens(set: TokenSet): void {
  tokens.set(SESSION_KEY, set);
}

export function getTokens(): TokenSet | undefined {
  return tokens.get(SESSION_KEY);
}

export function isAuthenticated(): boolean {
  return tokens.has(SESSION_KEY);
}

export function clearTokens(): void {
  tokens.delete(SESSION_KEY);
}

/**
 * Returns a valid access token, refreshing it if possible when expired.
 *
 * TODO: implement the real refresh flow — POST to
 * https://lucid.app/oauth2/token with grant_type=refresh_token and the stored
 * refresh_token, then store the new TokenSet. Until real credentials are
 * configured the mock token never truly expires, so we return it as-is.
 */
export async function getValidAccessToken(): Promise<string | undefined> {
  const current = getTokens();
  if (!current) return undefined;

  if (Date.now() >= current.expires_at && current.refresh_token) {
    // TODO: const res = await fetch("https://lucid.app/oauth2/token", {
    //   method: "POST",
    //   headers: { "Content-Type": "application/x-www-form-urlencoded" },
    //   body: new URLSearchParams({
    //     grant_type: "refresh_token",
    //     refresh_token: current.refresh_token,
    //     client_id: process.env.LUCID_CLIENT_ID ?? "",
    //     client_secret: process.env.LUCID_CLIENT_SECRET ?? "",
    //   }),
    // });
    // const refreshed = await res.json();
    // storeTokens({ ...current, ...refreshed, expires_at: Date.now() + (refreshed.expires_in ?? 3600) * 1000 });
    // return refreshed.access_token;
    return current.access_token;
  }

  return current.access_token;
}
