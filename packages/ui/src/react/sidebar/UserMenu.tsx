import { useTranslation } from "react-i18next"
import { useTheme } from "next-themes"
import {
  ChevronDown,
  LogOut,
  Moon,
  Sun,
  Monitor,
  CircleCheck,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu"
import { useUiRuntime } from "../../core/runtime"
import { cn } from "../../core/cn"

function getInitials(name?: string): string {
  if (!name) return ""
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return parts
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
}

const LANGUAGES = [
  { code: "en", label: "English", codeLabel: "EN" },
  { code: "ta", label: "தமிழ்", codeLabel: "TA" },
] as const

const THEMES = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const

export function UserMenu({
  name,
  email,
  avatarUrl,
  onLogout,
  subtitle,
  badgeLabel,
}: {
  name?: string
  email?: string
  avatarUrl?: string
  onLogout?: () => void
  /** Second line under the name. Falls back to `email` when omitted. */
  subtitle?: string
  /** Overrides the default "Signed in" badge label (e.g. "Verified Customer"). */
  badgeLabel?: string
}) {
  const { t, i18n } = useTranslation()
  const { theme, setTheme } = useTheme()
  const { normalizeLocale, persistLocale } = useUiRuntime().locale

  const initials = getInitials(name)
  const secondLine = subtitle ?? email
  const resolvedBadgeLabel =
    badgeLabel ?? t("sidebar.signed_in", { defaultValue: "Signed in" })
  const currentLocale = normalizeLocale(i18n.language)
  const currentTheme = theme ?? "system"

  const changeLanguage = (lng: string) => {
    const locale = normalizeLocale(lng)
    persistLocale(locale)
    void i18n.changeLanguage(locale)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        title={name}
        aria-label={
          name ? `Open account menu for ${name}` : "Open account menu"
        }
        className="group inline-flex min-w-0 cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-primary-foreground shadow-sm ring-2 ring-background ring-offset-1 ring-offset-border">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={name ?? ""}
              className="h-full w-full object-cover"
            />
          ) : initials ? (
            <span className="text-xs font-semibold">{initials}</span>
          ) : (
            <span className="text-xs font-semibold">?</span>
          )}
        </span>
        <span className="hidden min-w-0 text-left sm:block">
          <span className="block max-w-32 truncate text-xs font-semibold leading-tight text-foreground">
            {name || t("sidebar.user_fallback", { defaultValue: "Signed in" })}
          </span>
          {secondLine ? (
            <span className="block max-w-32 truncate text-[10px] leading-tight text-muted-foreground">
              {secondLine}
            </span>
          ) : null}
        </span>
        <ChevronDown
          size={14}
          className="shrink-0 text-muted-foreground transition-transform group-data-[popup-open]:rotate-180"
        />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-72 p-0 ring-0">
        {/* User Profile */}
        <div className="flex items-center gap-3 px-4 py-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground overflow-hidden">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={name ?? ""}
                className="h-full w-full object-cover"
              />
            ) : initials ? (
              <span className="text-sm font-semibold">{initials}</span>
            ) : (
              <span className="text-sm font-semibold">?</span>
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium leading-none truncate">
              {name ||
                t("sidebar.user_fallback", { defaultValue: "Signed in" })}
            </p>
            {secondLine ? (
              <p className="text-xs text-muted-foreground truncate mt-1">
                {secondLine}
              </p>
            ) : null}
            <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
              <CircleCheck size={10} />
              {resolvedBadgeLabel}
            </span>
          </div>
        </div>

        <DropdownMenuSeparator />

        {/* Language */}
        <div className="px-4 py-3">
          <p className="text-xs font-medium text-muted-foreground mb-1">
            {t("sidebar.language", { defaultValue: "Language" })}
          </p>
          <p className="text-[11px] text-muted-foreground/70 mb-2">
            {t("sidebar.language_description", {
              defaultValue: "Choose your preferred language",
            })}
          </p>
          <div className="flex gap-2">
            {LANGUAGES.map((lang) => (
              <button
                key={lang.code}
                type="button"
                onClick={() => changeLanguage(lang.code)}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer",
                  currentLocale === lang.code
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                )}
              >
                {lang.label}
                <span
                  className={cn(
                    "text-[10px]",
                    currentLocale === lang.code
                      ? "text-primary-foreground/70"
                      : "text-muted-foreground/50"
                  )}
                >
                  {lang.codeLabel}
                </span>
              </button>
            ))}
          </div>
        </div>

        <DropdownMenuSeparator />

        {/* Appearance */}
        <div className="px-4 py-3">
          <p className="text-xs font-medium text-muted-foreground mb-1">
            {t("sidebar.appearance", { defaultValue: "Appearance" })}
          </p>
          <p className="text-[11px] text-muted-foreground/70 mb-2">
            {t("sidebar.appearance_description", {
              defaultValue: "Select your color theme",
            })}
          </p>
          <div className="flex gap-2">
            {THEMES.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => setTheme(value)}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer",
                  currentTheme === value
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                )}
              >
                <Icon size={12} />
                {label}
              </button>
            ))}
          </div>
        </div>

        <DropdownMenuSeparator />

        {/* Logout */}
        <button
          type="button"
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-destructive/5 transition-colors cursor-pointer"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <LogOut size={14} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-destructive">
              {t("sidebar.logout", { defaultValue: "Logout" })}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {t("sidebar.logout_description", {
                defaultValue: "You will be signed out of your account",
              })}
            </p>
          </div>
        </button>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
