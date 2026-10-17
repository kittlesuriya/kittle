import { useEffect, useRef, useCallback } from "react"
import type { KeyboardEvent as ReactKeyboardEvent } from "react"
import { CHORD_TIMEOUT } from "./constants"

/**
 * Detect if running on Mac
 */
function detectMac(): boolean {
  if (typeof window === "undefined") return false

  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string }
  }

  if (nav.userAgentData?.platform) {
    return nav.userAgentData.platform === "macOS"
  }

  return /Mac|iPod|iPhone|iPad/.test(navigator.platform)
}

const isMac = detectMac()

export const kbdGlyph = isMac ? "⌘" : "Ctrl"

/**
 * Format hotkey for display
 */
export function formatHotkey(hk: string | undefined): string {
  if (!hk) return ""

  const parts = hk.split(" ").map((part) =>
    part
      .replace(/mod\+/gi, kbdGlyph + "+")
      .replace(/ctrl\+/gi, isMac ? "⌃+" : "Ctrl+")
      .replace(/alt\+/gi, isMac ? "⌥+" : "Alt+")
      .replace(/shift\+/gi, isMac ? "⇧+" : "Shift+")
      .toUpperCase()
  )

  return parts.join(" ")
}

/**
 * Normalize hotkey for matching
 */
export function normaliseHotkey(hk: string): string {
  const parts = hk.toLowerCase().trim().split(/\s+/)

  return parts
    .map((part) => {
      part = part.replace(/mod\+/gi, "ctrl+")
      const tokens = part.split("+")
      const key = tokens.pop() ?? ""
      const modifiers = tokens.sort()
      return [...modifiers, key].join("+")
    })
    .join(" ")
}

/**
 * Build combo string from keyboard event
 */
function buildCombo(e: KeyboardEvent): string {
  const modifiers: string[] = []

  if (e.altKey) modifiers.push("alt")
  if (e.ctrlKey || e.metaKey) modifiers.push("ctrl")
  if (e.shiftKey) modifiers.push("shift")

  modifiers.sort()

  let key = e.key.toLowerCase()

  if (["control", "meta", "alt", "shift"].includes(key)) {
    return ""
  }

  // macOS Option+<key> yields dead-key characters (Option+N → ˜) instead of
  // the letter, so fall back to the physical key for modified combos.
  // Unmodified presses keep e.key so alternate layouts keep working.
  if (
    (e.altKey || e.ctrlKey || e.metaKey) &&
    (key.length !== 1 || key < "a" || key > "z")
  ) {
    const codeMatch = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(e.code)
    const fromCode = (codeMatch?.[1] ?? codeMatch?.[2] ?? "").toLowerCase()
    if (fromCode) {
      key = fromCode
    }
  }

  return [...modifiers, key].join("+")
}

/**
 * Shared Alt+Enter-to-submit check for panel/form keydown handlers. The
 * global engine skips inputs by design, so submit surfaces handle this key
 * locally instead. Guards IME composition so CJK input is never submitted
 * mid-composition; callers still apply their own enabled/submitting gates.
 */
export function isAltEnterSubmit(e: ReactKeyboardEvent): boolean {
  if (!e.altKey || e.key !== "Enter" || e.defaultPrevented) return false
  if (e.keyCode === 229) return false
  const native = e.nativeEvent as
    (globalThis.KeyboardEvent & { isComposing?: boolean }) | undefined
  if (native?.isComposing) return false
  return true
}

/**
 * Hook for global keyboard shortcuts
 */
export function useGlobalHotkeys(map: Map<string, () => void>): void {
  const chordPrefixRef = useRef<string | null>(null)
  const chordTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearChord = useCallback(() => {
    chordPrefixRef.current = null
    if (chordTimeoutRef.current) {
      clearTimeout(chordTimeoutRef.current)
      chordTimeoutRef.current = null
    }
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
        clearChord()
        return
      }

      const combo = buildCombo(e)
      if (!combo) return

      if (chordPrefixRef.current) {
        const fullChord = `${chordPrefixRef.current} ${combo}`
        const exec = map.get(fullChord)

        clearChord()

        if (exec) {
          e.preventDefault()
          exec()
          return
        }
      }

      const exec = map.get(combo)
      if (exec) {
        e.preventDefault()
        clearChord()
        exec()
        return
      }

      let isChordStart = false
      map.forEach((_, key) => {
        if (key.startsWith(combo + " ")) {
          isChordStart = true
        }
      })

      if (isChordStart) {
        e.preventDefault()
        chordPrefixRef.current = combo

        chordTimeoutRef.current = setTimeout(() => {
          chordPrefixRef.current = null
        }, CHORD_TIMEOUT)
      }
    }

    window.addEventListener("keydown", handler)
    return () => {
      window.removeEventListener("keydown", handler)
      clearChord()
    }
  }, [map, clearChord])
}
