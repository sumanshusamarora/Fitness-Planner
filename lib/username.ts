export const USERNAME_STORAGE_KEY = "fitness-planner.username";

export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase();
}

/** Returns an error message, or null if the username is acceptable. */
export function validateUsername(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return "Enter a username.";
  if (trimmed.length > 40) return "Keep it under 40 characters.";
  if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) {
    return "Use letters, numbers, dots, dashes, or underscores only.";
  }
  return null;
}
