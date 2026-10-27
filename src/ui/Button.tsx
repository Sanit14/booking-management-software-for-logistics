import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Button.module.css';
import KeyCap from './KeyCap';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  small?: boolean;
  icon?: ReactNode;
  /** Shortcut hint shown in the button, e.g. "F4". The shortcut itself is wired by the page. */
  keyCap?: string;
}

export default function Button({ variant = 'primary', small = false, icon, keyCap, className, children, ...rest }: Props) {
  const cls = [styles.button, styles[variant], small ? styles.small : '', className ?? ''].join(' ').trim();
  // Filled variants carry white text, so their key chip is the white-on-colour kind.
  const onColor = variant === 'primary' || variant === 'secondary' || variant === 'danger';
  return (
    <button type="button" {...rest} className={cls}>
      {icon}
      {children}
      {keyCap && <KeyCap onColor={onColor}>{keyCap}</KeyCap>}
    </button>
  );
}
