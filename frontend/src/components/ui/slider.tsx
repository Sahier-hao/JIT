import type { ComponentProps } from 'react'
import { Slider as SliderPrimitive } from 'radix-ui'
import { cn } from '@/lib/utils'

function Slider({ className, defaultValue, value, min = 0, max = 100, step = 1, label, ...props }:
  ComponentProps<typeof SliderPrimitive.Root> & { label: string }) {
  const values = Array.isArray(value) ? value : Array.isArray(defaultValue) ? defaultValue : [min]
  return <SliderPrimitive.Root data-slot="slider" defaultValue={defaultValue} value={value}
    min={min} max={max} step={step}
    className={cn('relative flex w-full touch-none select-none items-center data-[disabled]:opacity-50', className)} {...props}>
    <SliderPrimitive.Track data-slot="slider-track" className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-strong">
      <SliderPrimitive.Range data-slot="slider-range" className="absolute h-full bg-accent"/>
    </SliderPrimitive.Track>
    {values.map((_, index) => <SliderPrimitive.Thumb key={index} data-slot="slider-thumb" aria-label={label}
      className="block size-4 rounded-full border-2 border-accent bg-card shadow-sm transition-[box-shadow] hover:ring-4 hover:ring-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none"/>)}
  </SliderPrimitive.Root>
}

export { Slider }
