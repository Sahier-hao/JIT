import type { ReactNode } from 'react'

const drawings = {
  logo: <><path d="m8 5-5 7 5 7M16 5l5 7-5 7M14 3l-4 18" /></>,
  list: <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M3 9h18M8 9v11M12 13h5M12 16h5" /></>,
  shortlist: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V2h6v2M9 10l1 1 2-2M14 10h2M9 16l1 1 2-2M14 16h2" /></>,
  project: <><path d="M4 7h6l2 2h8v10H4zM4 7V5h7l2 2h7v2" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></>,
  arrow: <><path d="M5 12h14m-5-5 5 5-5 5" /></>,
  chevron: <path d="m9 6 6 6-6 6" />,
  check: <path d="m5 12 4 4 10-10" />,
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7v.1" /></>,
  trend: <><path d="M4 4v16h16" /><path d="m7 15 4-4 3 2 5-6" /></>,
} satisfies Record<string, ReactNode>

export function Icon({ name, size = 18, className }: { name: keyof typeof drawings; size?: number; className?: string }) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{drawings[name]}</svg>
}
