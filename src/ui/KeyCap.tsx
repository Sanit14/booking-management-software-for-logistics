import styles from './KeyCap.module.css';

/** The little key chip ("F4", "Ctrl+L"). `onColor` = it sits on a coloured button or the teal banner. */
export default function KeyCap({ children, onColor = false }: { children: string; onColor?: boolean }) {
  return <kbd className={onColor ? `${styles.cap} ${styles.onColor}` : styles.cap}>{children}</kbd>;
}
