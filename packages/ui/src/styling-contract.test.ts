import { describe, expect, expectTypeOf, it } from "vitest"
import type {
  DataTableClassNames,
  DataTablePartClassNames,
  DataTableProps,
  QueryBuilderClassNames,
  QueryBuilderFieldStyles,
  QueryBuilderPartClassNames,
  QueryBuilderProps,
  SchemaFormClassNames,
  SchemaFormFieldStyles,
  SchemaFormPartClassNames,
  SchemaFormProps,
  SidebarClassNames,
  SidebarProps,
} from "./index"
import { cn } from "./core/cn"

describe("public styling contracts", () => {
  it("exports typed optional styling props from the package root", () => {
    expectTypeOf<QueryBuilderProps["classNames"]>().toEqualTypeOf<
      QueryBuilderClassNames | undefined
    >()
    expectTypeOf<DataTableProps<{ id: string }>["classNames"]>().toEqualTypeOf<
      DataTableClassNames | undefined
    >()
    expectTypeOf<SchemaFormProps["classNames"]>().toEqualTypeOf<
      SchemaFormClassNames | undefined
    >()
    expectTypeOf<SidebarProps["classNames"]>().toEqualTypeOf<
      SidebarClassNames | undefined
    >()
  })

  it("supports reusable plain style objects without a provider", () => {
    const styles = {
      container: "rounded-none p-6 shadow-none",
      groupHeader: "p-4",
    } satisfies QueryBuilderClassNames

    expect(cn("rounded-xl p-3 shadow-md", styles.container)).toBe(
      "rounded-none p-6 shadow-none"
    )
  })

  it("exports nested-part and field-specific contracts", () => {
    expectTypeOf<QueryBuilderProps["partClassNames"]>().toEqualTypeOf<
      QueryBuilderPartClassNames | undefined
    >()
    expectTypeOf<QueryBuilderProps["fieldStyles"]>().toEqualTypeOf<
      Record<string, QueryBuilderFieldStyles> | undefined
    >()
    expectTypeOf<SchemaFormProps["partClassNames"]>().toEqualTypeOf<
      SchemaFormPartClassNames | undefined
    >()
    expectTypeOf<SchemaFormProps["fieldStyles"]>().toEqualTypeOf<
      Record<string, SchemaFormFieldStyles> | undefined
    >()
    expectTypeOf<
      DataTableProps<{ id: string }>["partClassNames"]
    >().toEqualTypeOf<DataTablePartClassNames | undefined>()
    expectTypeOf<
      NonNullable<
        DataTableProps<{ id: string }>["filterConfig"]
      >["queryBuilderPartClassNames"]
    >().toEqualTypeOf<QueryBuilderPartClassNames | undefined>()
    expectTypeOf<
      NonNullable<
        DataTableProps<{ id: string }>["filterConfig"]
      >["queryBuilderFieldStyles"]
    >().toEqualTypeOf<Record<string, QueryBuilderFieldStyles> | undefined>()
  })

  it("keeps nested styling examples typed without a runtime dependency", () => {
    const parts = {
      multiSelect: { popover: "rounded-none", chip: "font-semibold" },
    } satisfies QueryBuilderPartClassNames
    const queryFields = {
      status: {
        classNames: { valueWrapper: "min-w-64" },
        partClassNames: parts,
      },
    } satisfies Record<string, QueryBuilderFieldStyles>
    const formFields = {
      "orders.*.lines.*.sku": {
        classNames: { control: "uppercase" },
      },
    } satisfies Record<string, SchemaFormFieldStyles>

    expect(queryFields.status.partClassNames.multiSelect.chip).toBe(
      "font-semibold"
    )
    expect(formFields["orders.*.lines.*.sku"].classNames.control).toBe(
      "uppercase"
    )
  })

  it("rejects unknown styling slots", () => {
    const styles: QueryBuilderClassNames = {
      // @ts-expect-error Slot names must be part of the public contract.
      unknownStylingSlot: "p-4",
    }
    expect(styles).toBeDefined()
  })

  it("restricts field overrides to field-owned parts", () => {
    const queryField: QueryBuilderFieldStyles = {
      classNames: {
        // @ts-expect-error A field override cannot style the builder's group container.
        group: "p-4",
      },
    }
    const formField: SchemaFormFieldStyles = {
      classNames: {
        // @ts-expect-error A field override cannot style the form's global actions.
        actions: "p-4",
      },
    }
    expect(queryField).toBeDefined()
    expect(formField).toBeDefined()
  })
})
