import { CircleHelp } from "lucide-react"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "../../ui/popover"
import { cn } from "../../../core/cn"

export interface FieldHelpClassNames {
  trigger?: string
  content?: string
  title?: string
  description?: string
  bullets?: string
  example?: string
}

interface FieldHelpProps {
  title: string
  description: string
  bullets?: string[]
  example?: string
  className?: string
  classNames?: FieldHelpClassNames
}

export function FieldHelp({
  title,
  description,
  bullets = [],
  example,
  className,
  classNames,
}: FieldHelpProps) {
  return (
    <Popover>
      <PopoverTrigger
        type="button"
        className={cn(
          "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
          className,
          classNames?.trigger
        )}
        aria-label={`Help: ${title}`}
      >
        <CircleHelp className="h-4 w-4" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className={cn(
          "w-[min(20rem,calc(100vw-1.5rem))] max-w-[calc(100vw-1.5rem)] p-3 duration-0 transition-none data-open:animate-none data-closed:animate-none sm:w-80 sm:max-w-xs",
          classNames?.content
        )}
      >
        <PopoverHeader>
          <PopoverTitle className={classNames?.title}>{title}</PopoverTitle>
          <PopoverDescription
            className={cn(
              "leading-relaxed break-words",
              classNames?.description
            )}
          >
            {description}
          </PopoverDescription>
        </PopoverHeader>
        {bullets.length > 0 ? (
          <ul
            className={cn(
              "list-disc pl-4 text-sm text-muted-foreground space-y-1 break-words",
              classNames?.bullets
            )}
          >
            {bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
        ) : null}
        {example ? (
          <div
            className={cn(
              "rounded-md border bg-muted/40 p-2 text-xs leading-relaxed break-words",
              classNames?.example
            )}
          >
            <span className="font-medium">Example: </span>
            {example}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
