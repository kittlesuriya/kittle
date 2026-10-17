import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

/**
 * Combines class names with Tailwind merge support.
 * Owned by the package so extracted components never import the app alias.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
