// Bearer token authentication middleware

export interface AuthContext {
  identity: string;
  isAdmin: boolean;
}

// Token -> identity mapping (loaded from config)
const tokens: Map<string, AuthContext> = new Map();

export function loadTokens(config: Record<string, { identity: string; admin?: boolean }>) {
  tokens.clear();
  for (const [token, info] of Object.entries(config)) {
    tokens.set(token, { identity: info.identity, isAdmin: info.admin || false });
  }
}

export function addToken(token: string, context: AuthContext) {
  tokens.set(token, context);
}

export function removeToken(token: string) {
  tokens.delete(token);
}

export function authenticate(request: Request): AuthContext | null {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }
  
  const token = authHeader.slice(7);
  return tokens.get(token) || null;
}

// Initialize from environment variables
// Supports two formats:
// 1) MAILBOX_TOKEN_<NAME>=<token> (e.g., MAILBOX_TOKEN_DOMINGO=xxx)
// 2) MAILBOX_TOKENS=<json> (e.g., {"token1":"domingo","token2":"clio"})
export function initFromEnv() {
  const config: Record<string, { identity: string; admin?: boolean }> = {};
  
  // Format 1: Individual env vars MAILBOX_TOKEN_<NAME>=<token>
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("MAILBOX_TOKEN_") && !key.endsWith("_ADMIN") && value) {
      const name = key.slice(14).toLowerCase();
      if (name && name !== "s") { // skip MAILBOX_TOKENS
        config[value] = { identity: name, isAdmin: false };
      }
    }
  }
  
  // Format 2: JSON mapping MAILBOX_TOKENS={"token":"identity",...}
  if (process.env.MAILBOX_TOKENS) {
    try {
      const mapping = JSON.parse(process.env.MAILBOX_TOKENS) as Record<string, string>;
      for (const [token, identity] of Object.entries(mapping)) {
        config[token] = { identity: identity.toLowerCase(), isAdmin: false };
      }
    } catch (err) {
      console.error("[auth] Failed to parse MAILBOX_TOKENS:", err);
    }
  }
  
  // Admin token
  if (process.env.MAILBOX_ADMIN_TOKEN) {
    config[process.env.MAILBOX_ADMIN_TOKEN] = { identity: "admin", isAdmin: true };
  }
  
  loadTokens(config);
  console.log(`[auth] Loaded ${tokens.size} token(s)`);
  
  // Debug: log identities (not tokens)
  if (tokens.size > 0) {
    const identities = [...tokens.values()].map(a => a.identity);
    console.log(`[auth] Identities: ${identities.join(", ")}`);
  }
}
