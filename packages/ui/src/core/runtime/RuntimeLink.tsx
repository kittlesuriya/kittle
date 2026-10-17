import type { ReactElement } from "react"
import { useUiRuntime } from "./context"
import type { LinkComponentProps } from "./types"

/**
 * Renders a navigation link through the bound `link` port (default: plain
 * `<a>`). Lets extracted components emit router-aware links without
 * importing the app router.
 */
export function RuntimeLink(props: LinkComponentProps): ReactElement {
  const Link = useUiRuntime().link
  return <Link {...props} />
}
