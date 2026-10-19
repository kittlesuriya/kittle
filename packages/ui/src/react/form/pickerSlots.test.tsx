// @vitest-environment jsdom
import * as React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { DatePicker } from "./DatePicker"
import { DateTimePicker } from "./DateTimePicker"

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
const mounted: Array<{ root: Root; host: HTMLDivElement }> = []
function render(element: React.ReactElement) {
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ root, host })
  act(() => root.render(element))
  return host
}
afterEach(() => {
  for (const { root, host } of mounted.splice(0)) {
    act(() => root.unmount())
    host.remove()
  }
})

it("styles date calendar slots and preserves day, today, and clear callbacks", () => {
  const change = vi.fn()
  const host = render(
    <DatePicker
      value="2024-01-15"
      onChange={change}
      classNames={{
        trigger: "trigger",
        content: "content",
        calendar: "calendar",
        header: "header",
        navigation: "navigation",
        monthButton: "month-button",
        yearButton: "year-button",
        weekdayGrid: "weekday-grid",
        weekday: "weekday",
        dayGrid: "day-grid",
        day: "day",
        monthGrid: "month-grid",
        monthChoice: "month-choice",
        yearGrid: "year-grid",
        yearChoice: "year-choice",
        footer: "footer",
        today: "today",
        clear: "clear",
      }}
    />
  )
  act(() => host.querySelector<HTMLButtonElement>(".trigger")?.click())
  for (const slot of [
    "content",
    "calendar",
    "header",
    "navigation",
    "weekday-grid",
    "weekday",
    "day-grid",
    "day",
    "footer",
    "today",
    "clear",
  ])
    expect(document.querySelector(`.${slot}`), slot).not.toBeNull()
  act(() => document.querySelector<HTMLButtonElement>(".month-button")?.click())
  expect(document.querySelector(".month-grid .month-choice")).not.toBeNull()
  act(() => document.querySelector<HTMLButtonElement>(".year-button")?.click())
  expect(document.querySelector(".year-grid .year-choice")).not.toBeNull()
  act(() => document.querySelector<HTMLButtonElement>(".year-choice")?.click())
  act(() => document.querySelector<HTMLButtonElement>(".month-choice")?.click())
  act(() => document.querySelector<HTMLButtonElement>(".day")?.click())
  expect(change).toHaveBeenCalledWith(expect.any(String))
  act(() => host.querySelector<HTMLButtonElement>(".trigger")?.click())
  act(() => document.querySelector<HTMLButtonElement>(".today")?.click())
  expect(change).toHaveBeenLastCalledWith(
    expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)
  )
  act(() => host.querySelector<HTMLButtonElement>(".trigger")?.click())
  act(() => document.querySelector<HTMLButtonElement>(".clear")?.click())
  expect(change).toHaveBeenLastCalledWith("")
})

it("styles datetime calendar and time controls and preserves clear callback", () => {
  const change = vi.fn()
  const host = render(
    <DateTimePicker
      value="2024-01-15T12:30:00"
      onChange={change}
      classNames={{
        trigger: "dt-trigger",
        content: "dt-content",
        calendar: "dt-calendar",
        header: "dt-header",
        navigation: "dt-navigation",
        monthSelectTrigger: "month-select",
        monthSelectContent: "month-popup",
        monthSelectItem: "month-option",
        yearSelectTrigger: "year-select",
        yearSelectContent: "year-popup",
        yearSelectItem: "year-option",
        weekdayGrid: "dt-weekdays",
        weekday: "dt-weekday",
        dayGrid: "dt-days",
        day: "dt-day",
        timePanel: "time-panel",
        timeInput: "time-input",
        footer: "dt-footer",
        now: "now",
        clear: "dt-clear",
      }}
    />
  )
  act(() => host.querySelector<HTMLButtonElement>(".dt-trigger")?.click())
  for (const slot of [
    "dt-content",
    "dt-calendar",
    "dt-header",
    "dt-navigation",
    "month-select",
    "year-select",
    "dt-weekdays",
    "dt-weekday",
    "dt-days",
    "dt-day",
    "time-panel",
    "time-input",
    "dt-footer",
    "now",
    "dt-clear",
  ])
    expect(document.querySelector(`.${slot}`), slot).not.toBeNull()
  act(() => document.querySelector<HTMLButtonElement>(".month-select")?.click())
  expect(document.querySelector(".month-popup")).not.toBeNull()
  expect(document.querySelector(".month-popup .month-option")).not.toBeNull()
  act(() =>
    document.querySelector<HTMLElement>('.month-popup [role="option"]')?.click()
  )
  act(() => document.querySelector<HTMLButtonElement>(".year-select")?.click())
  expect(document.querySelector(".year-popup")).not.toBeNull()
  expect(document.querySelector(".year-popup .year-option")).not.toBeNull()
  act(() =>
    document.querySelector<HTMLElement>('.year-popup [role="option"]')?.click()
  )
  act(() => {
    document
      .querySelector<HTMLInputElement>(".time-input")
      ?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })
      )
  })
  expect(change).toHaveBeenCalled()
  act(() => document.querySelector<HTMLButtonElement>(".dt-clear")?.click())
  expect(change).toHaveBeenCalledWith("")
})
