import type {
  FieldConfig,
  FormGroupConfig,
  FormLayoutConfig,
  FormSectionConfig,
  ResolvedFormGroup,
  ResolvedFormLayout,
  ResolvedFormSection,
} from "./types"

const DEFAULT_SECTION_ID = "general"

function byOrder<T extends { order?: number }>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      if (a.item.order === undefined && b.item.order === undefined) {
        return a.index - b.index
      }
      if (a.item.order === undefined) return 1
      if (b.item.order === undefined) return -1
      return a.item.order - b.item.order || a.index - b.index
    })
    .map(({ item }) => item)
}

function fieldsInOrder(fields: FieldConfig[]): FieldConfig[] {
  return byOrder(fields)
}

function makeGroup(config: FormGroupConfig): ResolvedFormGroup {
  return {
    id: config.id,
    title: config.title,
    description: config.description,
    columns: config.columns ?? 1,
    fields: [],
  }
}

function makeSection(config: FormSectionConfig): ResolvedFormSection {
  return {
    id: config.id,
    title: config.title,
    description: config.description,
    order: config.order,
    collapsible: config.collapsible,
    defaultOpen: config.defaultOpen,
    groups: (config.groups ?? []).map(makeGroup),
    fields: [],
  }
}

/**
 * Resolve field names into a renderer-ready layout.
 *
 * Explicit fields in `layout` win over field-level mappings. Remaining fields
 * use their `section`/`group` properties, and all other fields go to General.
 * The input configs and fields are never mutated.
 *
 * Hidden fields should be filtered out by the caller: `General` is only
 * rendered when it holds at least one field, so a hidden field left in here
 * would produce an empty section heading.
 */
export function resolveFormLayout(
  fields: FieldConfig[],
  layout?: FormLayoutConfig
): ResolvedFormLayout {
  const byName = new Map(fields.map((field) => [field.name, field]))
  const placed = new Set<string>()
  const sections = (layout?.sections ?? []).map(makeSection)
  const sectionById = new Map(sections.map((section) => [section.id, section]))
  const general: ResolvedFormSection = {
    id: DEFAULT_SECTION_ID,
    title: "General",
    groups: [],
    fields: [],
  }

  const getSection = (id: string): ResolvedFormSection => {
    const existing = sectionById.get(id)
    if (existing) return existing
    const created: ResolvedFormSection = {
      id,
      title: id,
      groups: [],
      fields: [],
    }
    sectionById.set(id, created)
    sections.push(created)
    return created
  }

  const getGroup = (
    section: ResolvedFormSection,
    id: string,
    config?: FormGroupConfig
  ): ResolvedFormGroup => {
    const existing = section.groups.find((group) => group.id === id)
    if (existing) return existing
    const created: ResolvedFormGroup = config
      ? makeGroup(config)
      : { id, columns: 1, fields: [] }
    section.groups.push(created)
    return created
  }

  const add = (
    field: FieldConfig | undefined,
    section: ResolvedFormSection,
    group?: ResolvedFormGroup
  ): void => {
    if (!field || placed.has(field.name)) return
    ;(group ? group.fields : section.fields).push(field)
    placed.add(field.name)
  }

  // Resolve explicit layout mappings first and retain their declared order.
  for (const config of layout?.sections ?? []) {
    const section = getSection(config.id)
    for (const name of config.fields ?? []) add(byName.get(name), section)
    for (const groupConfig of config.groups ?? []) {
      const group = getGroup(section, groupConfig.id, groupConfig)
      for (const name of groupConfig.fields) {
        add(byName.get(name), section, group)
      }
    }
  }
  for (const groupConfig of layout?.groups ?? []) {
    const group = getGroup(general, groupConfig.id, groupConfig)
    for (const name of groupConfig.fields) {
      add(byName.get(name), general, group)
    }
  }

  for (const field of fieldsInOrder(fields)) {
    if (placed.has(field.name)) continue
    const section = field.section ? getSection(field.section) : general
    add(
      field,
      section,
      field.group ? getGroup(section, field.group) : undefined
    )
  }

  if (general.fields.length > 0 || general.groups.length > 0) {
    if (!sectionById.has(general.id)) sections.push(general)
    sectionById.set(general.id, general)
  }

  return { sections: byOrder(sections) }
}
