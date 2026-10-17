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

## License

MIT
