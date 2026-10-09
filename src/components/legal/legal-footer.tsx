import { Link } from '@tanstack/react-router'
import { FOOTER_LINKS } from '~/lib/legal/documents'
import { cn } from '~/lib/utils'

/** Links to the legal pages; readable without signing in. */
export function LegalFooter({ className, dark = false }: { className?: string; dark?: boolean }) {
  return (
    <footer className={cn('text-sm', className)}>
      <nav aria-label="Legal">
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {FOOTER_LINKS.map((l) => (
            <li key={l.code}>
              <Link
                to="/legal/$code"
                params={{ code: l.code }}
                className={cn('inline-flex min-h-6 items-center underline-offset-2 hover:underline', dark ? 'text-sidebar-muted hover:text-sidebar-foreground' : 'text-muted-foreground hover:text-foreground')}
              >
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <p className={cn('mt-2', dark ? 'text-sidebar-muted' : 'text-muted-foreground')}>© {new Date().getFullYear()} ConsolFlora Ltd, Nairobi, Kenya</p>
    </footer>
  )
}
