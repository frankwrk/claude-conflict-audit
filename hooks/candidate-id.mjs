/**
 * Candidate ID derivation for conflict-detector.mjs
 *
 * Exported as a separate module so it can be unit-tested without importing
 * conflict-detector.mjs (which runs main logic at the top level).
 */

/**
 * Derive a stable, human-readable candidate ID from a tool name and response.
 *
 * Normalizes the response by stripping variable data (file paths, numbers,
 * hex strings) before taking significant words. This groups errors with the
 * same root cause under one ID even when message details differ, and keeps
 * structurally different errors distinct.
 */
export function deriveCandidateId(toolName, response) {
  const normalized = response
    .toLowerCase()
    .replace(/\/[^\s:,'"]+/g, " ")        // strip file paths
    .replace(/\b[0-9a-f-]{8,}\b/g, " ")  // strip hex strings / UUIDs
    .replace(/\b\d+\b/g, " ")            // strip standalone numbers
    .replace(/[^a-z\s]/g, " ")           // keep only letters
    .replace(/\s+/g, " ")
    .trim();

  const words = normalized.split(" ").filter(w => w.length > 2).slice(0, 8);
  const toolSlug = toolName.replace(/[^a-z0-9]/gi, "-").toLowerCase().slice(0, 20);
  return `${toolSlug}-${words.join("-")}`.slice(0, 60).replace(/-+$/, "");
}
