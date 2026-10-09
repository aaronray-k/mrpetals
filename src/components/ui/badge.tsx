import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '~/lib/utils'

const badgeVariants = cva('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-sm font-semibold [&_svg]:size-3.5', {
  variants: {
    variant: {
      default: 'bg-muted text-foreground',
      success: 'bg-success-bg text-success',
      warning: 'bg-warning-bg text-warning',
      destructive: 'bg-destructive/10 text-destructive',
      outline: 'border',
    },
  },
  defaultVariants: { variant: 'default' },
})

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}
