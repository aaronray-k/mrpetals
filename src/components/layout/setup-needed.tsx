import { Alert } from '~/components/ui/alert'

export function SetupNeeded() {
  return (
    <main className="mx-auto max-w-xl p-6">
      <Alert variant="warning" title="Supabase is not connected yet">
        Copy <code>.env.example</code> to <code>.env</code>, set <code>VITE_SUPABASE_URL</code> and{' '}
        <code>VITE_SUPABASE_ANON_KEY</code> for your self-hosted Supabase, run the migrations in{' '}
        <code>supabase/migrations</code>, then restart the app.
      </Alert>
    </main>
  )
}
