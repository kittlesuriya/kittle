// Generic registry for module-specific (custom) field types.
//
// The global form spec (zodToFields, FieldRenderer, formLogic, SchemaMetadata)
// stays domain-free. Feature modules register custom controls as needed.
import type { ComponentType } from "react"
import type { SchemaMetadata } from "./schemaMetadata"

export interface CustomFieldRendererProps {
  cfg: Record<string, unknown> & { name: string; label: string }
  fieldId: string
  value: unknown
  onChange: (value: unknown) => void
  disabled?: boolean
  formValues?: Record<string, unknown>
  /** Label association for rich editors (no labelable input inside). */
  labelledBy?: string
}

export interface CustomFieldDefinition {
  type: string
  parseExtra: (metadata: SchemaMetadata) => Record<string, unknown>
  getDefaultValue: () => unknown
  Renderer: ComponentType<CustomFieldRendererProps>
  selfLabeling?: boolean
  /** Label is associated via aria-labelledby instead of htmlFor. */
  labelledBy?: boolean
}

const definitions = new Map<string, CustomFieldDefinition>()

export function registerCustomField(def: CustomFieldDefinition): void {
  definitions.set(def.type, def)
}

export function isCustomFieldType(type: string): boolean {
  return definitions.has(type)
}

export function getCustomFieldParser(
  type: string
): ((metadata: SchemaMetadata) => Record<string, unknown>) | undefined {
  return definitions.get(type)?.parseExtra
}

export function getCustomFieldRenderer(
  type: string
): ComponentType<CustomFieldRendererProps> | undefined {
  return definitions.get(type)?.Renderer
}

export function getCustomFieldDefaultValue(type: string): unknown {
  return definitions.get(type)?.getDefaultValue()
}

export function isSelfLabelingFieldType(type: string): boolean {
  if (type === "array") return true
  return definitions.get(type)?.selfLabeling ?? false
}

/** True when the field's label must use aria-labelledby (rich editors). */
export function isLabelledByFieldType(type: string): boolean {
  return definitions.get(type)?.labelledBy ?? false
}
