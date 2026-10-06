import { createFileRoute } from '@tanstack/react-router'
import { useBuyers, useTemplate } from '~/lib/labels/api'
import { Designer } from '~/components/labels/designer'
import { RequireRole } from '~/components/layout/require-role'
import { rolesFor } from '~/components/layout/nav'
import { Alert } from '~/components/ui/alert'
import { Spinner } from '~/components/ui/spinner'

export const Route = createFileRoute('/_app/labels/$templateId')({
  head: () => ({ meta: [{ title: 'Label designer · ConsolFlora' }] }),
  component: () => (
    <RequireRole roles={rolesFor('/labels')}>
      <DesignerPage />
    </RequireRole>
  ),
})

function DesignerPage() {
  const { templateId } = Route.useParams()
  const template = useTemplate(templateId)
  const buyers = useBuyers()

  if (template.isLoading || buyers.isLoading) return <Spinner />
  if (template.error) {
    return (
      <Alert variant="destructive" title="Couldn't load this template" role="alert">
        {(template.error as Error).message}
      </Alert>
    )
  }
  if (!template.data || template.data.versions.length === 0) {
    return <Alert variant="warning" title="This label template doesn't exist" role="alert" />
  }
  return <Designer key={templateId} template={template.data} buyers={buyers.data ?? []} />
}
