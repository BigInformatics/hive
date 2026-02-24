import { getBaseUrl } from "./base-url";

/**
 * Replaces YOUR_HIVE_URL placeholder in skill docs with the configured base URL.
 * This makes skill docs self-referential when served from the actual instance.
 */
export function renderSkillDoc(doc: string): string {
  return doc.replace(/https:\/\/YOUR_HIVE_URL/g, getBaseUrl());
}
