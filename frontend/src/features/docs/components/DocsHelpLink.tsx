import { BookOpenText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { hashFor } from '@/app/navigation'

export function DocsHelpLink({ article, section, label, newTab = true, className }: {
  article: string
  section: string
  label: string
  newTab?: boolean
  className?: string
}) {
  return <Button variant="link" size="sm" asChild className={className}>
    <a
      href={hashFor({ name: 'docs', slug: article, section })}
      target={newTab ? '_blank' : undefined}
      rel={newTab ? 'noopener noreferrer' : undefined}
    >
      <BookOpenText aria-hidden="true" size={14}/>
      {label}
    </a>
  </Button>
}
