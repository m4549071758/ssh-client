import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type LabelHTMLAttributes } from 'react'

export const cn = (...args: any[]) => twMerge(clsx(...args))

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }>(
  ({ className, variant = 'primary', ...rest }, ref) => (
    <button
      ref={ref}
      {...rest}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-accent text-white hover:bg-accent-hover',
        variant === 'ghost' && 'bg-transparent text-fg hover:bg-bg-mute',
        variant === 'danger' && 'bg-rose-600 text-white hover:bg-rose-500',
        className
      )}
    />
  )
)
Button.displayName = 'Button'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...rest }, ref) => (
  <input
    ref={ref}
    {...rest}
    className={cn(
      'w-full rounded-md border border-border bg-bg-soft px-2.5 py-1.5 text-sm text-fg outline-none placeholder:text-fg-mute focus:border-accent',
      className
    )}
  />
))
Input.displayName = 'Input'

export function Label(props: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label {...props} className={cn('mb-1 block text-xs text-fg-mute', props.className)} />
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <Label>{label}</Label>
      {children}
    </div>
  )
}
