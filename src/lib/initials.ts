/**
 * Derive up to two uppercase initial letters from a person's name.
 *
 * Handles edge cases that trip up naive `split(" ")[0][0] + split(" ")[1][0]`
 * logic: double spaces, leading/trailing whitespace, single-word names, and
 * missing/empty input. Falls back to `"T"` when nothing usable is provided.
 */
export function getInitials(
  name: string | null | undefined,
  fallback = "T",
): string {
  const cleaned = (name ?? "").trim();
  if (!cleaned) return fallback;
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  const first = parts[0][0] ?? "";
  const second = parts[1]?.[0] ?? "";
  return (first + second || fallback).toUpperCase();
}
