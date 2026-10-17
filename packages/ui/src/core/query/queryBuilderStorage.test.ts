import { beforeEach, describe, expect, it } from "vitest"
import {
  FILTER_MODE_STORAGE_PREFIX,
  FILTER_STATE_STORAGE_PREFIX,
  clearQueryBuilderStorageForPath,
} from "./queryBuilderStorage"

describe("clearQueryBuilderStorageForPath", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it("removes only the given page's QueryBuilder entries", () => {
    window.localStorage.setItem(
      `${FILTER_STATE_STORAGE_PREFIX}/t/acme/access-control::a:text`,
      JSON.stringify({ logic: "AND", conditions: [], search: "" })
    )
    window.localStorage.setItem(
      `${FILTER_MODE_STORAGE_PREFIX}/t/acme/access-control::a:text`,
      "simple"
    )
    window.localStorage.setItem(
      `${FILTER_STATE_STORAGE_PREFIX}/t/acme/users::b:text`,
      JSON.stringify({ logic: "AND", conditions: [], search: "" })
    )
    window.localStorage.setItem("table-state-other-page", "{}")
    window.localStorage.setItem("unrelated", "keep")

    clearQueryBuilderStorageForPath("/t/acme/access-control")

    expect(
      window.localStorage.getItem(
        `${FILTER_STATE_STORAGE_PREFIX}/t/acme/access-control::a:text`
      )
    ).toBeNull()
    expect(
      window.localStorage.getItem(
        `${FILTER_MODE_STORAGE_PREFIX}/t/acme/access-control::a:text`
      )
    ).toBeNull()
    // Other pages and unrelated keys survive.
    expect(
      window.localStorage.getItem(
        `${FILTER_STATE_STORAGE_PREFIX}/t/acme/users::b:text`
      )
    ).not.toBeNull()
    expect(window.localStorage.getItem("table-state-other-page")).toBe("{}")
    expect(window.localStorage.getItem("unrelated")).toBe("keep")
  })

  it("does not confuse path prefixes", () => {
    window.localStorage.setItem(
      `${FILTER_STATE_STORAGE_PREFIX}/t/acme/users-archived::a:text`,
      "{}"
    )
    window.localStorage.setItem(
      `${FILTER_STATE_STORAGE_PREFIX}/t/acme/users::a:text`,
      "{}"
    )

    clearQueryBuilderStorageForPath("/t/acme/users")

    expect(
      window.localStorage.getItem(
        `${FILTER_STATE_STORAGE_PREFIX}/t/acme/users::a:text`
      )
    ).toBeNull()
    expect(
      window.localStorage.getItem(
        `${FILTER_STATE_STORAGE_PREFIX}/t/acme/users-archived::a:text`
      )
    ).toBe("{}")
  })
})
