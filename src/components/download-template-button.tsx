import { Download } from 'lucide-react'
import { buttonVariants } from '~/components/ui/button'
import { cn } from '~/lib/utils'

export const TEMPLATE_URL = '/templates/ConsolFlora_Import_Template.xlsx'

/** The official import workbook. One file holds every sheet, so each list page links the same template. */
export function DownloadTemplateButton({ className }: { className?: string }) {
  return (
    <a href={TEMPLATE_URL} download className={cn(buttonVariants({ variant: 'outline' }), className)}>
      <Download aria-hidden="true" />
      Download template
    </a>
  )
}
