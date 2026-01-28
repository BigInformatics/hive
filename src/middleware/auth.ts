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

export function authenticate(request: Request): AuthContext | null {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }
  
  const token = authHeader.slice(7);
  return tokens.get(token) || null;
}

// Initialize with default tokens from environment
export function initFromEnv() {
  // Format: MAILBOX_TOKEN_<name>=<token>
  // e.g., MAILBOX_TOKEN_DOMINGO=secret123
  const config: Record<string, { identity: string; admin?: boolean }> = {};
  
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("MAILBOX_TOKEN_") && value) {
      const name = key.slice(14).toLowerCase();
      config[value] = { identity: name, admin: key.endsWith("_ADMIN") };
    }
  }
  
  // Also support MAILBOX_ADMIN_TOKEN for admin access
  if (process.env.MAILBOX_ADMIN_TOKEN) {
    config[process.env.MAILBOX_ADMIN_TOKEN] = { identity: "admin", isAdmin: true };
  }
  
  loadTokens(config);
  console.log(`[auth] Loaded ${tokens.size} token(s)`);
}
