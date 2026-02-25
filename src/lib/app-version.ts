import { readFileSync } from "node:fs";
import { join } from "node:path";

function formatStamp(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}.${hh}`;
}

function readPackageVersion(): string {
  try {
    const raw = readFileSync(join(process.cwd(), "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
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
