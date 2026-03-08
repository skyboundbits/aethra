/**
 * src/components/icons.tsx
 * Shared SVG icon components used across the Aethra renderer.
 */

import type { SVGProps } from 'react'

/**
 * MinusIcon
 * Minimize icon based on the provided Lucide-style path definition.
 *
 * @param props - Standard SVG props forwarded to the root element.
 */
export function MinusIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M5 12h14" />
    </svg>
  )
}

/**
 * MaximizeIcon
 * Window maximize icon for the custom title bar.
 *
 * @param props - Standard SVG props forwarded to the root element.
 */
export function MaximizeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M6.75 7.75h10.5v8.5H6.75z" />
      <path d="M6.75 7.75h10.5" />
    </svg>
  )
}

/**
 * RestoreIcon
 * Window restore icon for the custom title bar.
 *
 * @param props - Standard SVG props forwarded to the root element.
 */
export function RestoreIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M8.75 9.75h8.5v7.5h-8.5z" />
      <path d="M8.75 9.75V7.25h8.5v2.5" />
      <path d="M6.75 11.75v5h8.5" />
    </svg>
  )
}

/**
 * XIcon
 * Close/exit icon based on the provided Lucide-style path definition.
 *
 * @param props - Standard SVG props forwarded to the root element.
 */
export function XIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  )
}
