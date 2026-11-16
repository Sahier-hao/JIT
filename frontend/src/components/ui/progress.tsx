
import * as React from "react"
import { cn } from "@/lib/utils"
import { Progress as ProgressPrimitive } from "radix-ui"

function Progress({
  className,
  value,
  max = 100,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      value={value}
      max={max}
      data-slot="progress"
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-full bg-primary/20",
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn("h-full flex-1 bg-primary transition-all", value == null ? "w-1/3 animate-pulse" : "w-full")}
        style={{ transform: value == null ? undefined : `translateX(-${100 - (value / max * 100)}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
