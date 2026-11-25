import { ChevronDown, ChevronRight, LogOut, Settings2, ShieldCheck, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function AccountMenu({ username, role, onProfile, onLogout }: {
  username: string
  role: 'user' | 'admin'
  onProfile?: () => void
  onLogout: () => void
}) {
  const Icon = role === 'admin' ? ShieldCheck : UserRound
  const roleName = role === 'admin' ? '管理员' : '普通用户'

  return <DropdownMenu modal={false}>
    <DropdownMenuTrigger asChild>
      <Button type="button" size="sm" variant="ghost" title={username}
        className="h-9 max-w-[min(38vw,11rem)] gap-1.5 rounded-full border border-border-soft bg-card py-0 pl-1 pr-2 text-sm data-[state=open]:bg-sunken">
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
          <Icon className="size-3.5" aria-hidden="true"/>
        </span>
        <span className="min-w-0 truncate">{username}</span>
        <ChevronDown className="size-3.5 text-foreground-3 transition-transform [[data-state=open]>&]:rotate-180" aria-hidden="true"/>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" sideOffset={8} collisionPadding={12}
      className="w-[min(16rem,calc(100vw-24px))] rounded-xl border-border-soft bg-card p-1.5 shadow-lg">
      <DropdownMenuLabel className="flex min-w-0 items-center gap-3 rounded-lg bg-sunken px-3 py-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
          <Icon className="size-[18px]" aria-hidden="true"/>
        </span>
        <span className="grid min-w-0 flex-1 gap-0.5">
          <strong className="truncate font-semibold" title={username}>{username}</strong>
          <span className="text-xs font-normal text-foreground-3">{roleName}</span>
        </span>
      </DropdownMenuLabel>
      <div className="mt-1.5">
        {onProfile ? <>
          <DropdownMenuItem onSelect={onProfile} className="cursor-pointer gap-2.5 rounded-md px-3 py-2">
            <Settings2 aria-hidden="true"/>个人中心<ChevronRight aria-hidden="true" className="ml-auto size-3.5"/>
          </DropdownMenuItem>
          <DropdownMenuSeparator className="mx-2 bg-border-soft"/>
        </> : null}
        <DropdownMenuItem variant="destructive" onSelect={onLogout} className="cursor-pointer gap-2.5 rounded-md px-3 py-2">
          <LogOut aria-hidden="true"/>{role === 'admin' ? '退出管理' : '退出登录'}
        </DropdownMenuItem>
      </div>
    </DropdownMenuContent>
  </DropdownMenu>
}
