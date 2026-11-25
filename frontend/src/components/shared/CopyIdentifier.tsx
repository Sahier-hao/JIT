import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'

export function CopyIdentifier({ value, label }: { value: string; label: string }) {
  const [result, setResult] = useState<{ value: string; copied: boolean }>()
  const current = result?.value === value ? result : undefined

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setResult({ value, copied: true })
    } catch {
      setResult({ value, copied: false })
    }
  }

  return <div className="flex min-w-0 flex-wrap items-center gap-x-1.5">
    <code className="min-w-0 text-xs text-foreground-3 [overflow-wrap:anywhere]">{value}</code>
    <Button type="button" variant="ghost" size="icon-xs" aria-label={`复制${label}`} title={`复制${label}`} onClick={() => void copy()}>
      {current?.copied ? <Check aria-hidden="true" className="text-accent"/> : <Copy aria-hidden="true"/>}
    </Button>
    <span role="status" className={current?.copied === false ? 'text-xs text-foreground-3' : 'sr-only'}>
      {current ? current.copied ? `${label}已复制` : '可选中文字手动复制' : ''}
    </span>
  </div>
}
