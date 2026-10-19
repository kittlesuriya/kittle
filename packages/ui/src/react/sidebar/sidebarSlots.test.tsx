// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MenuSection } from "./MenuSection"
import { SidebarSearch } from "./SidebarSearch"
import { SecondarySidebar } from "./SecondarySidebar"
import { FlyoutMenu } from "./FlyoutMenu"
import { Sidebar } from "./Sidebar"
import { UserMenu } from "./UserMenu"
import { UiRuntimeProvider } from "../../core/runtime"

const integrations = vi.hoisted(() => ({
  changeLanguage: vi.fn(),
  setTheme: vi.fn(),
}))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
    i18n: { language: "en", changeLanguage: integrations.changeLanguage },
  }),
}))
vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "dark", setTheme: integrations.setTheme }),
}))

describe("sidebar styling slots", () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    if (!window.matchMedia) {
      Object.defineProperty(window, "matchMedia", {
        value: () => ({
          matches: true,
          media: "",
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
        }),
      })
    }
  })

  afterEach(() => {
    if (root) act(() => root.unmount())
    host?.remove()
  })

  it("keeps menu item defaults and adds overrides for active and disabled items", () => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    act(() =>
      root.render(
        <MenuSection
          title=""
          items={[
            { title: "Current", path: "/current" },
            { title: "Unavailable", path: "/disabled", disabled: true },
          ]}
          collapsed={false}
          openIdx={null}
          pathname="/current"
          searchTerm=""
          toggleDropdown={() => {}}
          keyToggleDropdown={() => () => {}}
          keyNavigate={() => () => {}}
          setRef={() => {}}
          startIndex={0}
          showBadge
          showHotkeys
          classNames={{ menuItem: "custom-item" }}
        />
      )
    )
    const active = host.querySelector('a[href="/current"]')!
    const disabled = host.querySelector('[aria-disabled="true"]')!
    expect(active.className).toContain("custom-item")
    expect(active.className).toContain("bg-sidebar-primary")
    expect(disabled.className).toContain("custom-item")
    expect(disabled.className).toContain("cursor-not-allowed")
    expect(host.querySelectorAll(".custom-item")).toHaveLength(2)
    expect(host.firstElementChild?.classList.contains("custom-item")).toBe(
      false
    )
  })

  it("retains search styling while applying the standalone search slot", () => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    act(() =>
      root.render(
        <SidebarSearch
          value=""
          onChange={() => {}}
          className="existing-search"
          classNames={{ search: "search-slot" }}
        />
      )
    )
    const wrapper = host.firstElementChild!
    expect(wrapper.className).toContain("existing-search")
    expect(wrapper.className).toContain("search-slot")
    expect(host.querySelector("input")?.className).toContain("focus:ring-2")
  })

  it("clears search through the clear button callback and styles search elements", () => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    let value = "term"
    const change = (next: string) => {
      value = next
      act(() =>
        root.render(
          <SidebarSearch
            value={value}
            onChange={change}
            classNames={{
              searchInput: "search-input-slot",
              searchIcon: "search-icon-slot",
              searchClearButton: "search-clear-slot",
            }}
          />
        )
      )
    }
    act(() =>
      root.render(
        <SidebarSearch
          value={value}
          onChange={change}
          classNames={{
            searchInput: "search-input-slot",
            searchIcon: "search-icon-slot",
            searchClearButton: "search-clear-slot",
          }}
        />
      )
    )
    expect(host.querySelector("input")?.className).toContain(
      "search-input-slot"
    )
    expect(host.querySelector("svg")?.getAttribute("class")).toContain(
      "search-icon-slot"
    )
    const clear = host.querySelector("button")!
    expect(clear.className).toContain("search-clear-slot")
    act(() => clear.click())
    expect(value).toBe("")
    expect(host.querySelector("button")).toBeNull()
  })

  it("styles only secondary menu items and preserves active state and callbacks", async () => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    let back = 0
    let close = 0
    let deeper = 0
    await act(async () =>
      root.render(
        <SecondarySidebar
          isOpen
          items={[
            { title: "Current", path: "/current" },
            {
              title: "Deeper",
              path: "/deeper",
              children: [{ title: "Leaf", path: "/leaf" }],
            },
            { title: "Disabled", path: "/disabled", disabled: true },
          ]}
          parentTitle="Parent"
          onBack={() => back++}
          onClose={() => close++}
          onNavigateDeeper={() => deeper++}
          config={{}}
          width="w-68"
          collapsed={false}
          searchTerm=""
          pathname="/current"
          classNames={{
            menuItem: "secondary-item",
            secondaryHeader: "secondary-header-slot",
            secondaryBackButton: "secondary-back-slot",
            secondaryCloseButton: "secondary-close-slot",
            menuBadge: "secondary-badge-slot",
            menuHotkey: "secondary-hotkey-slot",
            menuDisclosureIcon: "secondary-disclosure-slot",
          }}
        />
      )
    )
    const item = host.querySelector('a[href="/current"]')!
    expect(item.className).toContain("secondary-item")
    expect(item.className).toContain("bg-sidebar-primary")
    expect(host.firstElementChild?.className).not.toContain("secondary-item")
    expect(host.querySelector(".secondary-header-slot")).not.toBeNull()
    await act(async () =>
      host
        .querySelector(".secondary-back-slot")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    )
    await act(async () => {
      host
        .querySelector(".secondary-close-slot")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(back).toBe(1)
    expect(close).toBe(1)
    expect(host.querySelectorAll(".secondary-item")).toHaveLength(3)
    expect(host.querySelector("svg.secondary-item")).toBeNull()
    expect(host.querySelector("svg.secondary-disclosure-slot")).not.toBeNull()
    const disabled = host.querySelector('[aria-disabled="true"]')
    expect(disabled?.classList.contains("secondary-item")).toBe(true)
    expect(disabled?.classList.contains("secondary-disclosure-slot")).toBe(
      false
    )
    act(() => {
      host.querySelector<HTMLButtonElement>("button.secondary-item")?.click()
    })
    expect(deeper).toBe(1)
  })

  it("styles flyout menu items only and keeps item actions intact", async () => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    let closed = false
    let navigated = ""
    act(() =>
      root.render(
        <FlyoutMenu
          currentItem={{
            title: "Parent",
            path: "/parent",
            children: [
              {
                title: "Child",
                path: "/child",
                hotkey: "ctrl+k",
                badge: "New",
              },
              {
                title: "Deeper",
                path: "#",
                children: [{ title: "Leaf", path: "/leaf" }],
              },
            ],
          }}
          pathname="/elsewhere"
          style={{}}
          navStack={[]}
          onNavigateDeeper={(next) => {
            navigated = next.title
          }}
          onGoBack={() => {}}
          onClose={() => {
            closed = true
          }}
          classNames={{
            menuItem: "flyout-item",
            flyoutHeader: "flyout-header-slot",
            flyoutBackButton: "flyout-back-slot",
            menuBadge: "flyout-badge-slot",
            menuHotkey: "flyout-hotkey-slot",
            menuDisclosureIcon: "flyout-disclosure-slot",
          }}
        />
      )
    )
    const item = host.querySelector('a[href="/child"]')!
    expect(item.className).toContain("flyout-item")
    expect(item.className).not.toContain("bg-sidebar-primary")
    expect(host.firstElementChild?.className).not.toContain("flyout-item")
    expect(host.querySelector(".flyout-header-slot")).not.toBeNull()
    expect(host.querySelector(".flyout-badge-slot")).not.toBeNull()
    expect(host.querySelector(".flyout-hotkey-slot")).not.toBeNull()
    item.addEventListener("click", (event) => event.preventDefault(), {
      once: true,
    })
    act(() => {
      item.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      )
    })
    expect(closed).toBe(true)
    const deeper = host.querySelector<HTMLButtonElement>(
      "button:not([disabled])"
    )!
    act(() => {
      deeper.click()
    })
    expect(navigated).toBe("Deeper")
  })

  it("forwards styling through the real Sidebar into header and organization parts", () => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    const slots = {
      headerLink: "header-link-slot",
      headerLogo: "header-logo-slot",
      headerTitle: "header-title-slot",
      headerSubtitle: "header-subtitle-slot",
      organizationSwitcher: "org-slot",
      organizationSwitcherIcon: "org-icon-slot",
      organizationSwitcherLabel: "org-label-slot",
      organizationSwitcherDescription: "org-description-slot",
      organizationSwitcherChevron: "org-chevron-slot",
    }
    act(() => {
      root.render(
        <Sidebar
          title="Example"
          subtitle="Workspace"
          classNames={slots}
          useSecondary={false}
          menuItems={[]}
        >
          Page
        </Sidebar>
      )
    })
    for (const marker of Object.values(slots)) {
      expect(host.querySelector(`.${marker}`), marker).not.toBeNull()
    }
  })

  it("styles user-menu portal sections without changing language, theme or logout actions", async () => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    const persistLocale = vi.fn()
    const logout = vi.fn()
    const slots = {
      userMenuProfile: "profile-slot",
      userMenuLanguageSection: "language-section-slot",
      userMenuLanguageOption: "language-option-slot",
      userMenuAppearanceSection: "appearance-section-slot",
      userMenuAppearanceOption: "appearance-option-slot",
      userMenuLogoutButton: "logout-slot",
    }
    await act(async () => {
      root.render(
        <UiRuntimeProvider
          runtime={{
            locale: {
              normalizeLocale: (locale) => locale ?? "en",
              persistLocale,
            },
          }}
        >
          <UserMenu name="Ada" onLogout={logout} classNames={slots} />
        </UiRuntimeProvider>
      )
    })
    await act(async () => {
      host.querySelector<HTMLButtonElement>("button")?.click()
    })
    for (const marker of Object.values(slots)) {
      expect(document.querySelector(`.${marker}`), marker).not.toBeNull()
    }
    const languages = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".language-option-slot")
    )
    expect(languages[0]?.classList.contains("bg-primary")).toBe(true)
    await act(async () => {
      languages[1]?.click()
    })
    expect(persistLocale).toHaveBeenCalledWith("ta")
    expect(integrations.changeLanguage).toHaveBeenCalledWith("ta")
    const themes = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".appearance-option-slot")
    )
    expect(themes[1]?.classList.contains("bg-primary")).toBe(true)
    await act(async () => {
      themes[0]?.click()
    })
    expect(integrations.setTheme).toHaveBeenCalledWith("light")
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".logout-slot")?.click()
    })
    expect(logout).toHaveBeenCalledOnce()
  })
})
