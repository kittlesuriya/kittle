import { describe, expect, it } from "vitest"
import { z } from "zod"
import type { FilterOutput } from "../query-builder"
import type { DataTableDataSource } from "../data-table"
import type { CustomFieldProps, FieldConfig } from "../schema-form"
import type { MenuItem } from "../sidebar"
import { encodeDataTableQuery } from "../adapters"
import {
  getFormLayout,
  schemaToFieldConfigs,
  withFormLayout,
  withMeta,
} from "../schema-form"
import { resolveFormLayout } from "../schema-form/layout"
import { defaultUiComponents, withUi, type UiConfig } from "../ui"

describe("shared TanStack UI contracts", () => {
  it("supports portable query output and application-owned data sources", () => {
    const query: FilterOutput = {
      logic: "AND",
      conditions: [{ field: "status", operator: "equals", value: "open" }],
    }
    const source: DataTableDataSource<{ id: string }> = {
      fetch: async () => ({ rows: [{ id: "1" }], total: 1 }),
    }
    expect(query.conditions).toHaveLength(1)
    expect(source).toBeDefined()
  })

  it("keeps form, navigation, and validation contracts generic", () => {
    const field: FieldConfig = { name: "name", label: "Name", type: "text" }
    const item: MenuItem = { title: "Customers", path: "/customers" }
    const schema = z.object({ name: z.string() })
    expect(field.name).toBe("name")
    expect(item.path).toBe("/customers")
    expect(schema.parse({ name: "Ada" })).toEqual({ name: "Ada" })
  })

  it("encodes table state for Fetch-compatible list endpoints", () => {
    const params = encodeDataTableQuery({
      page: 2,
      pageSize: 25,
      sorting: [{ id: "createdAt", desc: true }],
      search: "ada",
      filters: { logic: "AND", conditions: [] },
    })
    expect(params.get("page")).toBe("2")
    expect(params.get("search")).toBe("ada")
    expect(params.get("sort")).toContain("createdAt")
  })

  it("adapts schema metadata, defaults, arrays, and layouts", () => {
    const name = withMeta(z.string(), {
      label: "Display name",
      placeholder: "Enter a name",
      section: "profile",
      helpDescription: "Shown to other users.",
    })
    const schema = withFormLayout(
      z.object({
        name,
        age: z.number(),
        tags: z.array(z.object({ label: z.string() })),
      }),
      {
        sections: [{ id: "profile", title: "Profile", fields: ["name"] }],
        groups: [{ id: "details", fields: ["age"] }],
      }
    )
    const fields = schemaToFieldConfigs(schema)
    const resolved = resolveFormLayout(fields, getFormLayout(schema))

    expect(fields.find((field) => field.name === "name")).toMatchObject({
      label: "Display name",
      placeholder: "Enter a name",
      section: "profile",
      dataType: "string",
    })
    expect(fields.find((field) => field.name === "tags")).toMatchObject({
      type: "array",
      arrayItemSchema: [{ name: "label" }],
    })
    expect(resolved.sections.map((section) => section.id)).toEqual([
      "profile",
      "general",
    ])
    expect(
      resolved.sections.find((section) => section.id === "general")?.groups[0]
        ?.id
    ).toBe("details")
  })

  it("exposes an application UI bundle for HOC wrappers", () => {
    const appUi: UiConfig = {
      Autocomplete: defaultUiComponents.Autocomplete,
      MultiSelect: defaultUiComponents.MultiSelect,
      Switch: defaultUiComponents.Switch,
      Checkbox: defaultUiComponents.Checkbox,
      fieldRegistry: {
        customer: (props: CustomFieldProps) => {
          void props
          return null
        },
      },
    }
    const AppComponent = withUi(
      (props: { components?: UiConfig }) =>
        props.components?.fieldRegistry?.customer ? null : null,
      appUi
    )
    expect(AppComponent).toBeDefined()
    expect(appUi.fieldRegistry?.customer).toBeDefined()
  })
})
