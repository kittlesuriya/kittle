# Shared TanStack UI components

`kittle-tanstack` provides reusable React components for projects that share
the same application conventions without copying UI source code between
repositories. It is a presentation package; authorization and server-side
validation remain application and `kittle-core` responsibilities.

## Install

```sh
npm install kittle-tanstack @tanstack/react-table zod
```

Import the shared styles once in the application entry point:

```ts
import "kittle-tanstack/styles.css"
```

## Entry points

```ts
import { DataTable } from "kittle-tanstack/data-table"
import { SchemaForm } from "kittle-tanstack/schema-form"
import { QueryBuilder } from "kittle-tanstack/query-builder"
import { Sidebar } from "kittle-tanstack/sidebar"
import { createFetchDataSource } from "kittle-tanstack/adapters"
import { UiProvider } from "kittle-tanstack/ui"
import { withUi } from "kittle-tanstack/ui"
```

The components are intentionally configured through typed props. Project
specific API clients, permission systems, custom form fields, icons, and
navigation behavior are supplied by the consuming application rather than
being hard-coded into the package.

For projects that prefer configured component wrappers instead of a provider,
use `withUi`:

```tsx
const appUi = {
  Button: AppButton,
  Input: AppInput,
  Select: AppSelect,
  Textarea: AppTextarea,
  Autocomplete: AppAutocomplete,
  MultiSelect: AppMultiSelect,
  Switch: AppSwitch,
  Checkbox: AppCheckbox,
  fieldRegistry: {
    customer: CustomerField,
    map: MapField,
  },
}

export const AppDataTable = withUi(DataTable, appUi)
export const AppSchemaForm = withUi(SchemaForm, appUi)
export const AppQueryBuilder = withUi(QueryBuilder, appUi)
export const AppSidebar = withUi(Sidebar, appUi)
```

Each wrapper can then be used throughout the application without a root
provider. Component-level `components` props override the wrapper defaults.

## Custom rendering

The package includes accessible defaults, but applications can replace the
visual controls globally or per component:

```tsx
<UiProvider
  components={{
    Button: MyButton,
    Select: MySelect,
    Input: MyInput,
    Textarea: MyTextarea,
  }}
>
  <App />
</UiProvider>
```

Every major component also accepts a local `components` override. The shared
components retain state, validation, filtering, permissions, and accessibility
contracts while the application owns the button, dropdown, input, and styling
implementation. SchemaForm additionally supports a `fieldRegistry` for
application-specific fields.

## DataTable

`DataTable` supports local rows or a server-side data source:

```tsx
<DataTable
  columns={columns}
  dataSource={{
    fetch: (query) => api.customers.list(query),
  }}
  onRowClick={(customer) => openCustomer(customer.id)}
/>
```

For Fetch-compatible endpoints, use the included adapter:

```tsx
<DataTable
  columns={columns}
  dataSource={createFetchDataSource({ endpoint: "/api/customers" })}
/>
```

The table also supports client or server pagination, search, filter reset,
grouped headers, sorting, column visibility, persisted visibility state, row
selection, bulk-selection callbacks, refresh/retry actions, custom toolbar
content, and application-provided export handlers:

```tsx
<DataTable
  data={customers}
  columnsConfig={columns}
  searchable
  selectable
  persistStateKey="customers"
  exports={{ csv: { handler: ({ rows }) => downloadCsv(rows) } }}
  onSelectionChange={setSelectedCustomers}
  manualPagination={false}
  onRefresh={reload}
/>
```

## SchemaForm

Forms use the same Zod schemas that can be validated at the server boundary:

```tsx
<SchemaForm
  schema={customerSchema}
  fields={[
    { name: "name", label: "Name", type: "text", required: true },
    { name: "status", label: "Status", type: "select", options },
  ]}
  onSubmit={saveCustomer}
/>
```

SchemaForm also supports automatic Zod field generation, schema metadata and
layouts, nested arrays, conditional visibility, change/blur/submit validation,
server errors, dirty-state refs, submission guards, field slots, navigation
unload protection, and custom renderers for application-owned fields:

```tsx
const schema = withFormLayout(
  z.object({ name: withMeta(z.string(), { placeholder: "Customer name" }) }),
  { sections: [{ id: "main", title: "Customer", fields: ["name"] }] }
)

<SchemaForm
  schema={schema}
  validationMode="blur"
  enableNavigationGuard
  fieldSlots={{ name: ({ form }) => <small>{form.state.isDirty ? "Changed" : ""}</small> }}
  onSubmit={saveCustomer}
/>
```

File uploads, maps, markdown editors, autocomplete implementations, and domain
fields remain application-provided through `fieldRegistry` or
`customFieldRenderer`.

## QueryBuilder

`QueryBuilder` emits a portable nested `FilterGroup` value. Applications can
map that value to their API query contract or to the predicate model used by
the runtime adapters. It supports simple and advanced modes, nested groups,
operator labels, select and multiselect values, search, clear/apply actions,
disabled state, and optional persisted query/mode state.

## Sidebar

`Sidebar` accepts a generic navigation tree and an optional permission
callback. It does not depend on CASL or a specific router:

```tsx
<Sidebar
  items={menuItems}
  pathname={location.pathname}
  can={(permission) => ability.can(permission.action, permission.subject)}
  onNavigate={(item) => navigate(item.path)}
/>
```

Sidebar also supports recursive permission-aware filtering, active descendant
paths, navigation search, collapsible groups, persisted collapsed state,
keyboard activation, badges, hotkeys, and custom item rendering. Router
navigation remains application-owned through `onNavigate`.

## Extension policy

Application-specific fields, operations, permissions, API clients, and domain
modules should be registered or passed as props. They should not be added to
this package. This keeps one published implementation reusable across all
projects while allowing each project to retain its own business behavior.
