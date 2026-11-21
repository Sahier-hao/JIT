
import * as React from "react"
import { cn } from "@/lib/utils"
import { Progress as ProgressPrimitive } from "radix-ui"

function Progress({
  className,
  value,
  max = 100,
  inline = false,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> & { inline?: boolean }) {
  const indicator = (
    <ProgressPrimitive.Indicator
      asChild={inline}
      data-slot="progress-indicator"
      className={cn("block h-full flex-1 bg-primary transition-all", value == null ? "w-1/3 animate-pulse" : "w-full")}
      style={{ transform: value == null ? undefined : `translateX(-${100 - (value / max * 100)}%)` }}
    >
      {inline ? <span/> : null}
    </ProgressPrimitive.Indicator>
  )
  return (
    <ProgressPrimitive.Root
      value={value}
      max={max}
      asChild={inline}
      data-slot="progress"
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-full bg-primary/20",
        className
      )}
      {...props}
    >
      {inline ? <span>{indicator}</span> : indicator}
    </ProgressPrimitive.Root>
  )
}

export { Progress }
