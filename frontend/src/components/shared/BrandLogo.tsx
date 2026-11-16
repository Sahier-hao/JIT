import type { SVGProps } from 'react'

export function BrandLogo({ size = 16, className, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"
    strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true" focusable="false" className={className} {...props}>
    <path d="m7.5 4.5-4 5.5 4 5.5M12.5 4.5l4 5.5-4 5.5"/>
  </svg>
}
