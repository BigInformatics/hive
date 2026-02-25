import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function formatStamp(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}.${hh}`;
}

function normalizeVersion(value: string | undefined | null): string | null {
  if (!value) return null;
  const v = value.trim();
  return v.length > 0 ? v : null;
}

function readPackageVersion(): string {
  const envVersion =
    normalizeVersion(process.env.HIVE_APP_VERSION) ||
    normalizeVersion(process.env.npm_package_version);
  if (envVersion) return envVersion;

  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(process.cwd(), "package.json"),
    resolve(here, "../../package.json"),
    resolve(here, "../../../package.json"),
  ];

  for (const path of candidates) {
    try {
      if (!existsSync(path)) continue;
      const raw = readFileSync(path, "utf8");
      const pkg = JSON.parse(raw) as { version?: string };
      const v = normalizeVersion(pkg.version);
      if (v) return v;
    } catch {
      // try next candidate
    }
  }

  return "0.0.0";
}

const PACKAGE_VERSION = readPackageVersion();
const STARTUP_STAMP = formatStamp(new Date());

/**
 * Returns app version string for UI/API display.
 *
 * - If package.json already has a #timestamp suffix, use it as-is.
 * - Otherwise return <packageVersion>#YYYY-MM-DD.HH.
 */
export function getAppVersion(): string {
  if (PACKAGE_VERSION.includes("#")) return PACKAGE_VERSION;
  return `${PACKAGE_VERSION}#${STARTUP_STAMP}`;
}
