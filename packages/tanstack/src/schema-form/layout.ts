import type {
  FieldConfig,
  FormLayoutConfig,
  ResolvedFormLayout,
  ResolvedFormSection,
  ResolvedFormGroup,
} from "./types"

export function resolveFormLayout(
  fields: FieldConfig[],
  layout?: FormLayoutConfig
): ResolvedFormLayout {
  const byName = new Map(fields.map((field) => [field.name, field]))
  const placed = new Set<string>()
  const sections: ResolvedFormSection[] = (layout?.sections ?? []).map(
    (section) => ({
      ...section,
      groups: (section.groups ?? []).map((group) => ({ ...group, fields: [] })),
      fields: [],
    })
  )
  const general: ResolvedFormSection = {
    id: "general",
    title: "General",
    groups: [],
    fields: [],
  }
  const sectionMap = new Map(sections.map((section) => [section.id, section]))
  const getSection = (id: string) => {
    const existing = sectionMap.get(id)
    if (existing) return existing
    const created: ResolvedFormSection = {
      id,
      title: id,
      groups: [],
      fields: [],
    }
    sectionMap.set(id, created)
    sections.push(created)
    return created
  }
  const add = (
    field: FieldConfig | undefined,
    section: ResolvedFormSection,
    group?: ResolvedFormGroup
  ) => {
    if (!field || placed.has(field.name)) return
    ;(group ? group.fields : section.fields).push(field)
    placed.add(field.name)
  }
  for (const groupConfig of layout?.groups ?? []) {
    const group: ResolvedFormGroup = { ...groupConfig, fields: [] }
    for (const name of groupConfig.fields) add(byName.get(name), general, group)
    general.groups.push(group)
  }
  for (const config of layout?.sections ?? []) {
    const section = getSection(config.id)
    for (const name of config.fields ?? []) add(byName.get(name), section)
    for (const groupConfig of config.groups ?? []) {
      const group = section.groups.find(
        (item) => item.id === groupConfig.id
      ) ?? { ...groupConfig, fields: [] }
      if (!section.groups.includes(group)) section.groups.push(group)
      for (const name of groupConfig.fields)
        add(byName.get(name), section, group)
    }
  }
  for (const field of fields.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    if (placed.has(field.name)) continue
    const section = field.section ? getSection(field.section) : general
    const group = field.group
      ? section.groups.find((item) => item.id === field.group)
      : undefined
    add(field, section, group)
  }
  if (general.fields.length || general.groups.length) sections.push(general)
  return {
    sections: sections
      .map((section, index) => ({ section, index }))
      .sort(
        (left, right) =>
          (left.section.order ?? Number.MAX_SAFE_INTEGER) -
            (right.section.order ?? Number.MAX_SAFE_INTEGER) ||
          left.index - right.index
      )
      .map(({ section }) => section),
  }
}
