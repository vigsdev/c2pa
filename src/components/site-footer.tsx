import { FooterTagline } from "@/components/footer-tagline"
import { LocalTime } from "@/components/local-time"
import { cn } from "@/lib/utils"

// Same footer as vigs.dev. The date is the build date, set in vite.config.ts.
export function SiteFooter({ className }: { className?: string }) {
  const updated = new Date(__LAST_UPDATED__)

  return (
    <footer
      className={cn(
        "flex flex-col gap-1 text-xs leading-4 text-muted-foreground",
        className
      )}
    >
      <FooterTagline />
      <p>
        Last updated{" "}
        {updated.toLocaleDateString("en-US", {
          month: "short",
          year: "numeric",
          timeZone: "UTC",
        })}
      </p>
      <p>
        Chennai, India · <LocalTime />
      </p>
    </footer>
  )
}
