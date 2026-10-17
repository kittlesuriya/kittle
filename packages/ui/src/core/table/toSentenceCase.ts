/**
 * Converts a string to sentence case (first letter uppercase, rest lowercase).
 * Handles camelCase/PascalCase by inserting spaces before uppercase letters.
 *
 * Examples:
 *   "customerName" -> "Customer name"
 *   "CUSTOMER NAME" -> "Customer name"  
 *   "phone" -> "Phone"
 *   "createdAt" -> "Created at"
 */
export function toSentenceCase(str: string | undefined | null): string {
  if (!str) return ""
  const trimmed = str.trim()
  if (!trimmed) return ""

  // Split camelCase/PascalCase by inserting spaces before uppercase letters
  // but not at the start, and not for sequences of uppercase (acronyms)
  const withSpaces = trimmed.replace(/([A-Z]+)/g, " $1").trim()

  // If the result is all uppercase (was originally all caps), just capitalize first
  const isAllUpper =
    withSpaces === withSpaces.toUpperCase() &&
    withSpaces !== withSpaces.toLowerCase()
  if (isAllUpper) {
    return (
      withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1).toLowerCase()
    )
  }

  // Sentence case: first letter upper, rest unchanged for mixed case
  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1)
}
