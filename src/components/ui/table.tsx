import * as React from 'react'
import { cn } from '~/lib/utils'

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="relative w-full overflow-x-auto">
      <table className={cn('w-full border-collapse text-left text-sm', className)} {...props} />
    </div>
  )
}
export function THead(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className="bg-muted text-muted-foreground" {...props} />
}
export function TBody(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />
}
export function TR({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('border-b last:border-b-0', className)} {...props} />
}
export function TH({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th scope="col" className={cn('px-3 py-2.5 font-semibold whitespace-nowrap', className)} {...props} />
}
export function TD({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-3 py-2.5 align-top', className)} {...props} />
}
