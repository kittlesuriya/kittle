import type { LucideIcon } from "lucide-react"
import {
  Award,
  BookOpen,
  Briefcase,
  Calendar,
  CalendarClock,
  Check,
  CheckCircle,
  CircleUserRound,
  ClipboardCheck,
  Eye,
  FileText,
  GitBranch,
  History,
  Inbox,
  Layers,
  LayoutGrid,
  Link2,
  ListOrdered,
  ListTree,
  Lock,
  Paperclip,
  Pencil,
  Plus,
  Puzzle,
  RotateCcw,
  Send,
  ShieldCheck,
  Signpost,
  SlidersHorizontal,
  Target,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Undo2,
  Users,
  X,
  XCircle,
} from "lucide-react"

/**
 * Operation key -> icon, shared by `RowActions` (row menu) and
 * `OperationModal` (sheet/dialog header tile).
 *
 * Both used to keep their own private lookup, so they drifted: the header
 * knew `modules`/`members`/`schedule` while the menu knew only
 * `view`/`edit`/`delete`/`reverse`, and most operations — `inbox`,
 * `preview`, `domains`, `items` … — had no icon anywhere. One table means an
 * operation either has an icon in both places or neither.
 *
 * Size belongs to the caller: the menu renders 16px, the header tile 20px.
 * Per-operation `operation.icon` still wins when a page needs something else.
 */
export const OPERATION_ICONS: Record<string, LucideIcon> = {
  add: Plus,
  view: Eye,
  edit: Pencil,
  delete: Trash2,
  complete: Check,
  dismiss: X,
  cancel: XCircle,
  close: Lock,
  reverse: Undo2,
  retry: RotateCcw,
  review: ClipboardCheck,
  approve: ThumbsUp,
  reject: ThumbsDown,
  verify: CheckCircle,
  members: Users,
  schedule: Calendar,
  modules: Puzzle,
  preview: Eye,
  testSend: Send,
  inbox: Inbox,
  history: History,
  "manage-versions": GitBranch,
  // Learning Design relationship editors.
  domains: Layers,
  outcomes: Target,
  coverage: LayoutGrid,
  relations: Link2,
  prerequisites: ListTree,
  items: ListOrdered,
  // Tenant EDU row-action managers (learner/facilitator/cohort/delivery
  // child cards promoted out of the View sheets).
  profile: CircleUserRound,
  preferences: SlidersHorizontal,
  documents: FileText,
  consents: ShieldCheck,
  assignments: Briefcase,
  expertise: Award,
  syllabus: BookOpen,
  sessions: CalendarClock,
  // Content library editors (tenant.contentItems row ops).
  attach: Paperclip,
  relate: Link2,
  nodes: GitBranch,
  access: Lock,
  // Learner path access (direct grants + batch snapshots).
  paths: Signpost,
}

export function getOperationIcon(key: string): LucideIcon | undefined {
  return OPERATION_ICONS[key]
}

const PRIMARY_ACTION =
  "text-primary-ink focus:text-primary-ink focus:bg-primary/15 dark:text-primary dark:focus:text-primary dark:focus:bg-primary/10"
const DESTRUCTIVE_ACTION =
  "text-destructive focus:text-destructive focus:bg-destructive/10"
const NEUTRAL_ACTION = "text-foreground focus:bg-accent"

/**
 * Row-menu colour per operation key. Only the operations that are visually
 * primary or destructive are listed — everything else falls back to the
 * neutral menu colour, which is what an unlisted key rendered before.
 */
export const OPERATION_COLOR_CLASS: Record<string, string> = {
  view: PRIMARY_ACTION,
  edit: PRIMARY_ACTION,
  delete: DESTRUCTIVE_ACTION,
  reverse: DESTRUCTIVE_ACTION,
}

export function getOperationColorClass(key: string): string {
  return OPERATION_COLOR_CLASS[key] ?? NEUTRAL_ACTION
}
