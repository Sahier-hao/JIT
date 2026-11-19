import { useState, type ComponentProps } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export function PasswordField({ className, ...props }: Omit<ComponentProps<typeof Input>, 'type'>) {
  const [visible, setVisible] = useState(false)
  return <div className="relative">
    <Input {...props} type={visible ? 'text' : 'password'} className={cn('pr-10', className)}/>
    <Button type="button" variant="ghost" size="icon-sm" className="absolute right-0.5 top-1/2 -translate-y-1/2"
      aria-label={visible ? '隐藏密码' : '显示密码'} aria-pressed={visible} disabled={props.disabled}
      onClick={() => setVisible(current => !current)}>
      {visible ? <EyeOff aria-hidden="true"/> : <Eye aria-hidden="true"/>}
    </Button>
  </div>
}
