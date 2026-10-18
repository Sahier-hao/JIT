/**
 * 自绘图标集合。
 *
 * 材料规范（design D5 / IP-09）：20×20 网格、1.5 描边、方头端点、矩形圆角 2。
 * 所有图标共用同一套几何约定，显示尺寸默认 16px；不引入外部图标库。
 */
import type { ReactNode } from 'react'

const drawings = {
  logo: <><path d="m7.5 4.5-4 5.5 4 5.5M12.5 4.5l4 5.5-4 5.5" /></>,
  list: <><rect x="3" y="4.5" width="14" height="11" rx="2" /><path d="M3 9h14M8.5 9v6.5" /></>,
  shortlist: <><rect x="5" y="3.5" width="10" height="13" rx="2" /><path d="m7.5 8 1 1 1.5-1.5M7.5 12.5l1 1 1.5-1.5" /></>,
  project: <><path d="M3.5 6.5h5l1.5 2h6.5v8h-13z" /><path d="M3.5 6.5v-2h5.5l1.5 2" /></>,
  search: <><circle cx="9" cy="9" r="5" /><path d="m13 13 3.5 3.5" /></>,
  arrow: <><path d="M4 10h12M12 6l4 4-4 4" /></>,
  chevron: <><path d="m7.5 5 5 5-5 5" /></>,
  check: <><path d="m4 10 4 4 8-8" /></>,
  plus: <><path d="M10 4v12M4 10h12" /></>,
  close: <><path d="m5 5 10 10M15 5 5 15" /></>,
  info: <><circle cx="10" cy="10" r="7.5" /><path d="M10 9v5M10 6.5v.01" /></>,
  trend: <><path d="M3.5 16.5V3.5M3.5 16.5h13" /><path d="m5.5 13 2.5-4 2.5 2 4-6" /></>,
  sliders: <><path d="M3.5 7h13M3.5 13h13" /><rect x="6" y="5" width="3.5" height="4" rx="2" /><rect x="11" y="11" width="3.5" height="4" rx="2" /></>,
  copy: <><rect x="6" y="6" width="10" height="10" rx="2" /><path d="M4 14V5.5A1.5 1.5 0 0 1 5.5 4H14" /></>,
  external: <><path d="M11 4h5v5" /><path d="m16 4-7 7" /><path d="M14 12v4H4V6h4" /></>,
  warning: <><path d="M10 3.5 17 16.5H3z" /><path d="M10 8v4M10 14v.01" /></>,
  collapse: <><path d="m11.5 5-5 5 5 5" /></>,
  filter: <><path d="M3.5 5.5h13l-5 5.5v5l-3 1.5v-6.5z" /></>,
  sort: <><path d="M6 4v12M3.5 13.5 6 16l2.5-2.5" /><path d="M14 16V4M11.5 6.5 14 4l2.5 2.5" /></>,
  download: <><path d="M10 3.5v9M6.5 9.5 10 13l3.5-3.5" /><path d="M4 16.5h12" /></>,
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof drawings

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
    >
      {drawings[name]}
    </svg>
  )
}

export const ICON_NAMES = Object.keys(drawings) as IconName[]
