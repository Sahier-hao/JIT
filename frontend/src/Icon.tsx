/**
 * 唯一图标入口。
 *
 * 除品牌标志外，图形统一来自 lucide-react：24 网格、1.5 描边、圆头端点。
 * 页面与组件只通过 `<Icon name="…" />` 取图标，不直接依赖图标库，
 * 这样网格、线宽与语义在一个地方维护（IP-09）。
 */
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowUpDown,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Database,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Filter,
  Folder,
  GitCompare,
  Info,
  List,
  Loader,
  MoreHorizontal,
  Pin,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings,
  SlidersHorizontal,
  Trash2,
  TrendingUp,
  Upload,
  User,
  X,
  XCircle,
  type LucideIcon,
} from 'lucide-react'

const icons = {
  list: List,
  project: Folder,
  search: Search,
  arrow: ArrowRight,
  arrowLeft: ArrowLeft,
  arrowUpRight: ArrowUpRight,
  chevron: ChevronRight,
  chevronDown: ChevronDown,
  collapse: ChevronLeft,
  check: Check,
  plus: Plus,
  close: X,
  info: Info,
  warning: AlertTriangle,
  trend: TrendingUp,
  sliders: SlidersHorizontal,
  copy: Copy,
  external: ExternalLink,
  filter: Filter,
  sort: ArrowUpDown,
  download: Download,
  upload: Upload,
  user: User,
  eye: Eye,
  eyeOff: EyeOff,
  database: Database,
  fileText: FileText,
  gitCompare: GitCompare,
  loader: Loader,
  more: MoreHorizontal,
  pin: Pin,
  refresh: RefreshCw,
  rotate: RotateCcw,
  save: Save,
  settings: Settings,
  trash: Trash2,
  xCircle: XCircle,
} satisfies Record<string, LucideIcon>

export type IconName = keyof typeof icons | 'logo'

export const ICON_NAMES = [...Object.keys(icons), 'logo'] as IconName[]

/** 品牌标志保留自绘：20 网格、1.5 描边、方头端点。 */
function BrandLogo({ size = 16, className }: { size?: number; className?: string }) {
  return <svg
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
    <path d="m7.5 4.5-4 5.5 4 5.5M12.5 4.5l4 5.5-4 5.5" />
  </svg>
}

export function Icon({ name, size = 16, className, strokeWidth = 1.5, fill }: { name: IconName; size?: number; className?: string; strokeWidth?: number; fill?: string }) {
  if (name === 'logo') return <BrandLogo size={size} className={className}/>
  const Glyph = icons[name]
  return <Glyph size={size} strokeWidth={strokeWidth} fill={fill} className={className} aria-hidden="true" focusable="false"/>
}
