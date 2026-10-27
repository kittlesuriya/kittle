# kittle-ui

Reusable React UI for the application security and execution specification:
data tables, schema-driven forms, query builders, navigation, feedback states,
and UI primitives.

The package is application-agnostic. Every platform capability it needs —
navigation, permissions, date formatting, analytics, notifications, and
request execution — is supplied by the host application through the
`UiRuntime` ports, so the same components work with any router, permission
model, or HTTP client.

## What this package provides

- **DataTable** — server/client pagination, search, filters, grouped columns,
  column visibility and reordering, selection, row operations, export hooks,
  and granular permission checks.
- **SchemaForm** — Zod-driven form generation with nested arrays, conditional
  visibility, validation modes, server errors, submission guards, field slots,
  and custom field renderers.
- **QueryBuilder** — simple and advanced modes, nested groups, operator
  metadata, persisted state, and custom value renderers.
- **Sidebar** — recursive permission filtering, search, active descendant
  state, collapsible navigation with flyouts, persistence, and keyboard
  activation.
- **UI primitives** — buttons, dialogs, sheets, inputs, selects, comboboxes,
  autocomplete, multi-select, cards, tabs, tables, feedback states, and more,
  styled with Tailwind CSS and Base UI.

## Requirements

- Node.js 20 or newer (the package is ESM-only)
- React 19
- Tailwind CSS in the host application, with the installed package output
  included in your content sources

## Installation

```sh
npm install kittle-ui
```

Peer dependencies (npm 7+ installs them automatically): `react`, `react-dom`,
`@tanstack/react-table`, `@tanstack/react-form`, `@tanstack/react-query`,
`zod`, `lucide-react`, `react-i18next`, and `sonner`.

## Entry points

The root barrel exposes the runtime ports and the shared form, query, menu,
and table contracts; each area also has a directory entrypoint.

| Import specifier                | Contents                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------ |
| `kittle-ui`                     | Runtime ports, provider, and the core form/query/menu/table contracts          |
| `kittle-ui/core/runtime`        | `UiRuntimeProvider`, `useUiRuntime`, `RuntimeLink`, ability and entity helpers |
| `kittle-ui/core/form`           | Schema parsing, field registry, validation and condition logic, layout         |
| `kittle-ui/core/query`          | Query-builder state, operators, storage, Zod filter fields                     |
| `kittle-ui/core/table`          | Table state, operation validation, permissions, column reorder                 |
| `kittle-ui/core/menu`           | Menu filtering, hotkeys, shared constants                                      |
| `kittle-ui/react/data-table`    | `DataTable` plus its parts and hooks                                           |
| `kittle-ui/react/form`          | `SchemaForm`, `FieldRenderer`, `FieldArray`, and specialized field pickers     |
| `kittle-ui/react/query-builder` | `QueryBuilder` and its parts                                                   |
| `kittle-ui/react/sidebar`       | `Sidebar`, secondary navigation, flyouts, and the user menu                    |
| `kittle-ui/react/ui/*`          | UI primitives                                                                  |
| `kittle-ui/react/feedback/*`    | Empty and inline-error states                                                  |

Every built module is also reachable through the wildcard deep paths
(`kittle-ui/core/*` and `kittle-ui/react/*`); the table above lists the stable
entrypoints.

## Binding the runtime

Mount `UiRuntimeProvider` once and supply the ports the UI consumes. Each port
is optional and falls back to safe defaults, but unbound capabilities fail
loudly at the point of use instead of silently returning incorrect data.

```tsx
import { UiRuntimeProvider } from "kittle-ui/core/runtime"

export function App() {
  return (
    <UiRuntimeProvider
      runtime={{
        // Router integration; `RuntimeLink` and the Sidebar use these.
        navigation: { pathname, search, navigate },
        // CASL-like ability: { can(action, subject) }.
        ability,
        // Hook-shaped adapters so call order matches TanStack Query.
        request: { useMutation, useQuery },
        notify: { success, error },
      }}
    >
      {/* routes */}
    </UiRuntimeProvider>
  )
}
```

## Styling

Components use Tailwind CSS utility classes against host theme tokens (for
example `bg-card`, `text-muted-foreground`, and `bg-primary`). Ensure your
Tailwind content sources include the installed package, e.g. Tailwind v4:

```css
@source "../node_modules/kittle-ui/dist";
```

Import the package stylesheet once to enable marquee scrolling in sidebar
labels and row-action labels. The animation runs while an item is hovered or
keyboard-focused/highlighted, and resets to the start when that state ends:

```ts
import "kittle-ui/styles.css"
```

### Styling internal parts

Use `className` to style a component's outer element and `classNames` to
override named internal parts. No styling provider or wrapper component is
required:

```tsx
import { QueryBuilder } from "kittle-ui/react/query-builder"

function Filters() {
  return (
    <QueryBuilder
      schema={filterSchema}
      className="w-full"
      classNames={{
        container: "rounded-none border bg-background p-6 sm:p-6 shadow-none",
        group: "rounded-md bg-muted",
        groupHeader: "p-4",
        condition: "py-3",
        actions: "border-0",
      }}
    />
  )
}
```

Slot names are component-specific and typed for autocomplete. Unspecified
slots retain their existing styles. Overrides are merged after the default
and state classes with `tailwind-merge`, so conflicting Tailwind utilities
can replace defaults. Existing `className` props retain their original
behavior. Styling does not replace component behavior or permission checks.
Responsive and state variants remain independent: use `sm:p-6` to override
`sm:p-4`, or `dark:bg-background` to override a dark-mode background.

| Component    | Slot type                | Type import            |
| ------------ | ------------------------ | ---------------------- |
| QueryBuilder | `QueryBuilderClassNames` | `kittle-ui/core/query` |
| DataTable    | `DataTableClassNames`    | `kittle-ui/core/table` |
| SchemaForm   | `SchemaFormClassNames`   | `kittle-ui/core/form`  |
| Sidebar      | `SidebarClassNames`      | `kittle-ui/core/menu`  |

These types are also available from `kittle-ui`. Composite primitives and
feedback components export their styling types from their individual modules.

Repeated parts share their slot styles: for example, QueryBuilder's `group`
and `condition` overrides also apply inside nested groups. Simple primitives
such as Button and the individual Card parts already accept `className`;
use that prop when rendering them directly.

You can also reuse a plain typed object across instances without a provider
or wrapper:

```tsx
import type { QueryBuilderClassNames } from "kittle-ui/core/query"

const filterStyles = {
  container: "rounded-none border shadow-none",
  groupHeader: "p-4",
} satisfies QueryBuilderClassNames

<QueryBuilder schema={filterSchema} classNames={filterStyles} />
```

For filters embedded in DataTable, pass QueryBuilder styles through
`filterConfig.queryBuilderClassNames` alongside the filter schema:

```tsx
const filterConfig = {
  schema: filterSchema,
  queryBuilderClassNames: filterStyles,
}
```

### Nested components and field-specific styling

`partClassNames` styles the components created internally by a composite.
For example, QueryBuilder can forward styles into the MultiSelect popup and
chips rather than only its trigger:

```tsx
function Filters() {
  return (
    <QueryBuilder
      schema={filterSchema}
      partClassNames={{
        valueSelect: { content: "rounded-none", item: "py-3" },
        multiSelect: {
          popover: "rounded-none shadow-none",
          chip: "bg-secondary text-secondary-foreground",
        },
      }}
      fieldStyles={{
        status: {
          classNames: { valueWrapper: "min-w-64" },
          partClassNames: { multiSelect: { chip: "font-semibold" } },
        },
      }}
    />
  )
}
```

QueryBuilder field keys are filter field IDs and apply in both simple and
advanced modes, including conditions inside nested groups. SchemaForm uses
schema paths, with `*` matching an array index:

```tsx
function Editor() {
  return (
    <SchemaForm
      schema={formSchema}
      classNames={{ control: "text-sm" }}
      partClassNames={{ multiSelect: { popover: "rounded-none" } }}
      fieldStyles={{
        email: { classNames: { control: "font-mono" } },
        "rows.*.quantity": { classNames: { control: "text-right" } },
        "orders.*.lines.*.sku": { classNames: { control: "uppercase" } },
      }}
    />
  )
}
```

Shared styles are merged with field-specific styles rather than replaced
wholesale. Field-specific utilities win conflicts; in forms, more specific
path matches override less specific wildcard matches, and exact paths win
over wildcard paths. Paths describe schema fields, not generated DOM IDs.
Prefer wildcard paths for array rows so styles continue to apply as items
are added or removed. Existing array `listClassName` overrides remain last.

DataTable also exposes `partClassNames` for its feedback and operation
Dialog/Sheet components. Its filter configuration forwards
`queryBuilderPartClassNames` and `queryBuilderFieldStyles` in addition to
`queryBuilderClassNames`.

Public nested styling contracts are `QueryBuilderPartClassNames`,
`QueryBuilderFieldStyles`, `SchemaFormPartClassNames`,
`SchemaFormFieldStyles`, and `DataTablePartClassNames`, exported through their
respective core entrypoints and the package root. Primitive slot types are
exported from their owning modules. Autocomplete's root configuration styles
its generated parts; directly supplied part `className` overrides remain
available when composing it yourself.

Use structural slots for the parent-owned layout and nested-part slots for
the child component's own elements:

- QueryBuilder: groups/conditions/actions versus selector popups and
  MultiSelect chips, options, and search controls.
- SchemaForm: sections/fields/array actions versus picker, help, and
  selection-control internals.
- DataTable: toolbar menus/pagination/state layouts versus feedback content
  and generated operation Dialog/Sheet surfaces.
- Sidebar: header/search/menu details, secondary/flyout actions, user-menu
  sections/options, and the organization placeholder's visible parts.

Slot names are semantic rather than DOM selectors. A slot for repeated items
styles all matching items, while a conditionally rendered slot only has an
effect when its corresponding element is present.

#### Expanded styling surfaces

| Area         | Representative structural slots                                                                                                                        | Nested part keys                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| QueryBuilder | `filterTrigger`, `groupLogicToggle`, `addConditionButton`, `removeConditionButton`, `rangeSeparator`                                                   | `fieldSelect`, `operatorSelect`, `valueSelect`, `multiSelect`, `emptyState`                                |
| SchemaForm   | `field`, `label`, `errorRow`, `arrayHeader`, `arrayAddButton`, `arrayRemoveButton`, `arrayEmpty`, `arrayCompactContent`                                | `select`, `multiSelect`, `autocomplete`, `password`, `help`, `datePicker`, `dateTimePicker`, `colorPicker` |
| DataTable    | `columnMenuContent`, `exportMenuItem`, `paginationSelect`, `paginationButton`, `loadingCell`, `errorRetry`, `operationConfirm`                         | `emptyState`, `errorMessage`, `operationDialog`, `operationSheet`                                          |
| Sidebar      | `searchInput`, `headerTitle`, `menuBadge`, `menuHotkey`, `menuDisclosureIcon`, `secondaryBackButton`, `userMenuLanguageOption`, `organizationSwitcher` | Sidebar parts share the `SidebarClassNames` map                                                            |

The exported slot types are the full supported inventory. For example,
`partClassNames.datePicker.day` styles a form's calendar day buttons;
`partClassNames.dateTimePicker.timeInput` styles its time controls; and
`partClassNames.multiSelect.chipRemove` styles generated chip removal controls.
Select part maps expose `trigger`, `content`, and `item`, including portaled
content. Autocomplete's explicitly supplied part `className` takes precedence
over its root's shared slot configuration.

Styles target existing elements, including portaled popups. They do not
change selection, permissions, validation, disabled behavior, or navigation.
Registered custom form controls and caller-rendered actions, field slots,
and operation content remain caller-owned; their internal styles are not
rewritten by these APIs. The OrganizationSwitcher is still a placeholder:
its styling slots do not add organization-switching behavior.

Styling props do not introduce an additional client-side provider. Interactive
components still require their existing React hooks and application setup.

## License

MIT
