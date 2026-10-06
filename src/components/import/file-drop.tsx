import * as React from 'react'
import { FileSpreadsheet, UploadCloud } from 'lucide-react'
import { cn } from '~/lib/utils'

/** File picker that also accepts drag and drop. The real <input> stays in the tab order with a proper label. */
export function FileDrop({ onFile, fileName, busy }: { onFile: (f: File) => void; fileName?: string; busy?: boolean }) {
  const [over, setOver] = React.useState(false)
  return (
    <label
      htmlFor="import-file"
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const f = e.dataTransfer.files[0]
        if (f) onFile(f)
      }}
      className={cn(
        'flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-input bg-card p-8 text-center transition-colors focus-within:border-accent hover:border-accent',
        over && 'border-accent bg-info-bg',
      )}
    >
      {fileName ? (
        <FileSpreadsheet className="size-10 text-accent" aria-hidden="true" />
      ) : (
        <UploadCloud className="size-10 text-muted-foreground" aria-hidden="true" />
      )}
      <span className="text-lg font-bold">{fileName ?? 'Choose the filled-in template'}</span>
      <span className="text-sm text-muted-foreground">
        {busy ? 'Reading the file…' : fileName ? 'Choose another file to replace it' : 'Drop an .xlsx file here, or click to browse. Up to 5 MB.'}
      </span>
      <input
        id="import-file"
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
          e.target.value = ''
        }}
      />
    </label>
  )
}
