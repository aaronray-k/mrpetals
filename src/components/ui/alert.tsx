import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import { cn } from '~/lib/utils'

const alertVariants = cva('flex gap-3 rounded-lg border p-4 [&>svg]:mt-0.5 [&>svg]:size-5 [&>svg]:shrink-0', {
  variants: {
    variant: {
      info: 'bg-info-bg',
      success: 'border-success/40 bg-success-bg [&>svg]:text-success',
      warning: 'border-warning/40 bg-warning-bg [&>svg]:text-warning',
      destructive: 'border-destructive/40 bg-destructive/10 [&>svg]:text-destructive',
    },
  },
  defaultVariants: { variant: 'info' },
})

const icons = { info: Info, success: CheckCircle2, warning: AlertTriangle, destructive: XCircle }

/** Status box. Always shows an icon and a text title, so meaning never depends on colour alone. */
export function Alert({
  variant = 'info',
  title,
  children,
  className,
  role,
}: VariantProps<typeof alertVariants> & {
  title: React.ReactNode
  children?: React.ReactNode
  className?: string
  role?: 'status' | 'alert'
}) {
  const Icon = icons[variant ?? 'info']
  return (
    <div role={role} className={cn(alertVariants({ variant }), className)}>
      <Icon aria-hidden="true" />
      <div className="grid gap-1">
        <p className="font-bold">{title}</p>
        {children && <div className="text-sm">{children}</div>}
      </div>
    </div>
  )
}
