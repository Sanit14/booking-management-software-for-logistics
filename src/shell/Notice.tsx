import { strings } from '../strings';
import styles from './Notice.module.css';

/** Whole-window message while the keeper is starting or could not be reached. `alert` = something is wrong. */
export default function Notice({ text, alert = false }: { text: string; alert?: boolean }) {
  return (
    <main className={styles.page}>
      <div className={`${styles.card} ${alert ? styles.alert : ''}`.trim()} role={alert ? 'alert' : 'status'}>
        <div className={styles.title}>{strings.appTitle}</div>
        <p>{text}</p>
      </div>
    </main>
  );
}
