import type { ButtonHTMLAttributes, ReactNode } from 'react'
import styles from './Button.module.css'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: 'sm' | 'md'
  children: ReactNode
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  children,
  ...rest
}: Props) {
  return (
    <button
      type="button"
      className={`${styles.btn} ${styles[variant]} ${styles[size]} ${className || ''}`}
      {...rest}
    >
      {children}
    </button>
  )
}
