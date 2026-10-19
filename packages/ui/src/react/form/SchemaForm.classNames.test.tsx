// @vitest-environment jsdom
import * as React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { SchemaForm } from "./SchemaForm"
import { FieldArray } from "./FieldArray"
import { FieldRenderer } from "./FieldRenderer"
import { withMeta } from "../../core/form/schemaMetadata"
import {
  resolveFieldStyles,
  mergeFieldStyles,
} from "../../core/form/fieldStyles"

const mounted: Array<{ root: Root; container: HTMLElement }> = []
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }),
})
const hasClasses = (element: Element | null, ...classes: string[]) => {
  expect(element).not.toBeNull()
  for (const name of classes)
    expect(element?.classList.contains(name), name).toBe(true)
}
function render(element: React.ReactElement) {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  mounted.push({ root, container })
  act(() => root.render(element))
  return container
}

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount())
    container.remove()
  }
})

describe("SchemaForm classNames", () => {
  it("resolves wildcard paths before exact paths and merges nested slots", () => {
    const resolved = mergeFieldStyles(
      ...resolveFieldStyles(
        {
          "groups.*.rows.*.value": { classNames: { control: "wild" } },
          "groups.2.rows.*.value": { classNames: { control: "near" } },
          "groups.2.rows.1.value": { classNames: { control: "exact" } },
        },
        "groups.2.rows.1.value"
      )
    )
    expect(resolved.classNames?.control).toBe("wild near exact")
  })

  it("isolates field styles and reaches newly rendered nested array rows", () => {
    const container = render(
      <SchemaForm
        schema={z.object({
          groups: z.array(
            z.object({ rows: z.array(z.object({ value: z.string() })) })
          ),
          other: z.string(),
        })}
        defaultValues={{ groups: [{ rows: [{ value: "a" }] }] }}
        fieldStyles={{
          "groups.*.rows.*.value": { classNames: { control: "nested-wild" } },
          "groups.0.rows.0.value": { classNames: { control: "nested-exact" } },
          other: { classNames: { control: "other-only" } },
        }}
      />
    )
    expect(
      container.querySelector("input.nested-wild.nested-exact")
    ).toBeTruthy()
    expect(container.querySelector("input.other-only")).toBeTruthy()
    expect(
      container
        .querySelector("input.nested-wild")
        ?.classList.contains("other-only")
    ).toBe(false)
    const add = container.querySelector(
      '[data-testid="add-rows-item"]'
    ) as HTMLButtonElement
    expect(add).toBeTruthy()
    act(() => add.click())
    expect(container.querySelectorAll("input.nested-wild")).toHaveLength(2)
    const remove = container.querySelector<HTMLButtonElement>(
      '[data-testid="remove-rows-item-0"]'
    )
    act(() => {
      remove?.click()
    })
    expect(container.querySelectorAll("input.nested-wild")).toHaveLength(1)
  })

  it("styles field wrappers and labels without leaking array-specific control parts", () => {
    const container = render(
      <SchemaForm
        schema={z.object({
          rows: z.array(
            z.object({
              secret: withMeta(z.string(), { inputType: "password" }),
            })
          ),
          other: z.string(),
        })}
        defaultValues={{ rows: [{ secret: "x" }], other: "" }}
        classNames={{ label: "shared-label" }}
        partClassNames={{ password: { root: "shared-password" } }}
        fieldStyles={{
          rows: {
            classNames: { field: "array-field-only" },
            partClassNames: { password: { root: "array-part-only" } },
          },
          "rows.*.secret": {
            classNames: { field: "secret-field", label: "secret-label" },
            partClassNames: { password: { root: "secret-password" } },
          },
          other: { classNames: { field: "other-field", label: "other-label" } },
        }}
      />
    )
    expect(container.querySelector(".array-field-only")).not.toBeNull()
    expect(container.querySelectorAll(".array-field-only")).toHaveLength(1)
    expect(
      container.querySelector(".secret-field .secret-label.shared-label")
    ).not.toBeNull()
    expect(
      container.querySelector(".other-field .other-label.shared-label")
    ).not.toBeNull()
    expect(
      container.querySelector(".shared-password.secret-password")
    ).not.toBeNull()
    expect(container.querySelector(".array-part-only")).toBeNull()
  })

  it("applies field generic controls after shared parts and field-specific parts last", () => {
    const styles = mergeFieldStyles(
      { partClassNames: { password: { root: "shared-password h-8" } } },
      { classNames: { control: "h-12" } },
      { partClassNames: { password: { root: "specific-password h-16" } } }
    )
    expect(styles.partClassNames?.password?.root).toBe(
      "shared-password specific-password h-16"
    )
  })
  it("styles flat fields and preserves caller-owned slots", () => {
    const container = render(
      <SchemaForm
        schema={z.object({ name: z.string() })}
        className="caller-form"
        classNames={{
          form: "form-override",
          grid: "flat-grid",
          field: "cell",
          label: "field-label",
          control: "control",
          actions: "actions",
        }}
        fieldSlots={{
          name: () => <aside data-testid="owned-slot" className="slot" />,
        }}
      />
    )
    hasClasses(container.querySelector("form"), "caller-form", "form-override")
    expect(container.querySelector(".flat-grid")).toBeTruthy()
    expect(container.querySelector(".cell")).toBeTruthy()
    hasClasses(container.querySelector("label"), "field-label")
    hasClasses(container.querySelector("input"), "control")
    hasClasses(container.querySelector("[data-testid=owned-slot]"), "slot")
  })

  it("styles section and group elements on their existing DOM nodes", () => {
    const container = render(
      <SchemaForm
        schema={z.object({ name: z.string() })}
        layout={{
          sections: [
            {
              id: "profile",
              title: "Profile",
              groups: [
                {
                  id: "identity",
                  title: "Identity",
                  columns: 1,
                  fields: ["name"],
                },
              ],
            },
          ],
        }}
        classNames={{
          sections: "sections",
          section: "section",
          sectionHeading: "section-heading",
          sectionBody: "section-body",
          group: "group",
          groupHeading: "group-heading",
          grid: "group-grid",
          field: "group-field",
        }}
      />
    )
    for (const token of [
      "sections",
      "section",
      "section-heading",
      "section-body",
      "group",
      "group-heading",
      "group-grid",
      "group-field",
    ])
      expect(container.querySelector(`.${token}`), token).toBeTruthy()
  })

  it("styles nested arrays while preserving listClassName and caller actions", () => {
    const container = render(
      <SchemaForm
        schema={z.object({ rows: z.array(z.object({ value: z.string() })) })}
        defaultValues={{ rows: [{ value: "x" }] }}
        hideActions={false}
        renderActions={() => (
          <aside data-testid="custom-actions" className="owned-actions" />
        )}
        classNames={{
          array: "array",
          arrayLabel: "array-label",
          arrayList: "list-override",
          arrayItem: "item",
          arrayItemHeader: "item-header",
          arrayGrid: "item-grid",
          field: "nested-field",
          control: "nested-control",
        }}
      />
    )
    const list = container.querySelector(".list-override")
    hasClasses(list, "space-y-3", "list-override")
    expect(container.querySelector(".array")).toBeTruthy()
    expect(container.querySelector(".array-label")).toBeTruthy()
    expect(container.querySelector(".item")).toBeTruthy()
    expect(container.querySelector(".item-header")).toBeTruthy()
    expect(container.querySelector(".item-grid")).toBeTruthy()
    expect(container.querySelector(".nested-field")).toBeTruthy()
    expect(container.querySelector(".nested-control")).toBeTruthy()
    hasClasses(
      container.querySelector(".nested-control")?.parentElement ?? null,
      "nested-field"
    )
    hasClasses(
      container.querySelector("[data-testid=custom-actions]"),
      "owned-actions"
    )
  })

  it("keeps legacy array list overrides and styles compact item fields", () => {
    const container = render(
      <FieldArray
        name="rows"
        label="Rows"
        itemFields={[{ name: "value", label: "Value", type: "text" }]}
        value={[{ __localId: "item", value: "x" }]}
        onChange={() => {}}
        compactItems
        listClassName="space-y-8 legacy-list"
        classNames={{
          arrayList: "space-y-4 slot-list",
          arrayCompactItem: "compact-item",
          arrayCompactContent: "compact-content",
          field: "compact-field",
          label: "compact-label",
        }}
      />
    )
    const list = container.querySelector(".slot-list")
    hasClasses(list, "space-y-8", "legacy-list")
    expect(list?.classList.contains("space-y-4")).toBe(false)
    expect(
      container.querySelector(".compact-item .compact-field")
    ).not.toBeNull()
    hasClasses(container.querySelector(".compact-label"), "sr-only")
    expect(
      container.querySelector(".compact-item .compact-content")
    ).not.toBeNull()
  })

  it("styles built-in switch and time controls directly", () => {
    const container = render(
      <>
        <FieldRenderer
          cfg={{ name: "enabled", label: "Enabled", type: "switch" }}
          value={true}
          onChange={() => {}}
          classNames={{ control: "switch-control" }}
        />
        <FieldRenderer
          cfg={{ name: "time", label: "Time", type: "time" }}
          value="12:00"
          onChange={() => {}}
          classNames={{ control: "time-control h-12" }}
        />
      </>
    )
    hasClasses(container.querySelector('[role="switch"]'), "switch-control")
    hasClasses(
      container.querySelector('input[type="time"]'),
      "time-control",
      "h-12"
    )
    expect(
      container.querySelector('input[type="time"]')?.classList.contains("h-10")
    ).toBe(false)
  })

  it("forwards multiselect and password part classes to their owned DOM parts", () => {
    const container = render(
      <>
        <FieldRenderer
          cfg={{
            name: "tags",
            label: "Tags",
            type: "multiselect",
            options: [{ label: "One", value: "one" }],
          }}
          value={[]}
          onChange={() => {}}
          partClassNames={{
            multiSelect: {
              trigger: "multi-trigger",
              popover: "multi-popup",
              option: "multi-option",
            },
          }}
        />
        <FieldRenderer
          cfg={{ name: "secret", label: "Secret", type: "password" }}
          value=""
          onChange={() => {}}
          partClassNames={{
            password: {
              root: "password-root",
              input: "password-input",
              toggle: "password-toggle",
            },
          }}
        />
      </>
    )
    const multiTrigger = container.querySelector(
      ".multi-trigger"
    ) as HTMLButtonElement
    expect(multiTrigger).toBeTruthy()
    act(() => multiTrigger.click())
    expect(document.body.querySelector(".multi-popup")).toBeTruthy()
    expect(
      container.querySelector(".password-root .password-input")
    ).toBeTruthy()
    expect(container.querySelector(".password-toggle")).toBeTruthy()
  })

  it("forwards autocomplete and date/color part classes to their real DOM nodes", () => {
    const container = render(
      <>
        <FieldRenderer
          cfg={{
            name: "choice",
            label: "Choice",
            type: "autocomplete",
            options: [{ label: "One", value: "one" }],
          }}
          value=""
          onChange={() => {}}
          partClassNames={{
            autocomplete: { control: "ac-root", input: "ac-input" },
          }}
        />
        <FieldRenderer
          cfg={{ name: "date", label: "Date", type: "date" }}
          value=""
          onChange={() => {}}
          partClassNames={{
            datePicker: { trigger: "date-trigger", content: "date-popup" },
          }}
        />
        <FieldRenderer
          cfg={{ name: "when", label: "When", type: "datetime" }}
          value=""
          onChange={() => {}}
          partClassNames={{
            dateTimePicker: { trigger: "dt-trigger", content: "dt-popup" },
          }}
        />
        <FieldRenderer
          cfg={{ name: "color", label: "Color", type: "color" }}
          value="#ffffff"
          onChange={() => {}}
          partClassNames={{
            colorPicker: {
              root: "color-root",
              swatch: "color-swatch",
              input: "color-input",
            },
          }}
        />
      </>
    )
    expect(container.querySelector(".ac-root .ac-input")).toBeTruthy()
    expect(container.querySelector(".date-trigger")).toBeTruthy()
    expect(container.querySelector(".dt-trigger")).toBeTruthy()
    expect(container.querySelector(".color-root .color-swatch")).toBeTruthy()
    expect(container.querySelector(".color-root .color-input")).toBeTruthy()
  })

  it("styles array help, empty state, actions and errors while retaining add behavior", async () => {
    const changed = vi.fn()
    const container = render(
      <FieldArray
        name="rows"
        label="Rows"
        itemFields={[{ name: "value", label: "Value", type: "text" }]}
        value={[]}
        onChange={changed}
        errors={["Invalid rows"]}
        isSubmitted
        help={{
          title: "Row help",
          description: "Description",
          bullets: ["One"],
          example: "Example",
        }}
        classNames={{
          arrayHeader: "array-header",
          arrayAddButton: "array-add",
          arrayEmpty: "array-empty",
          arrayHelp: "array-help",
          arrayErrors: "array-errors",
          errorRow: "array-error-row",
        }}
        partClassNames={{
          help: {
            content: "help-popup",
            title: "help-title",
            description: "help-description",
            bullets: "help-bullets",
            example: "help-example",
          },
        }}
      />
    )
    for (const slot of [
      "array-header",
      "array-add",
      "array-empty",
      "array-help",
      "array-errors",
      "array-error-row",
    ]) {
      expect(container.querySelector(`.${slot}`), slot).not.toBeNull()
    }
    act(() => {
      container.querySelector<HTMLButtonElement>(".array-add")?.click()
    })
    expect(changed).toHaveBeenCalledWith([
      expect.objectContaining({ value: "" }),
    ])
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".array-help")?.click()
    })
    for (const slot of [
      "help-popup",
      "help-title",
      "help-description",
      "help-bullets",
      "help-example",
    ]) {
      expect(document.querySelector(`.${slot}`), slot).not.toBeNull()
    }
  })
})
