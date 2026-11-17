import type { KeeperHealth } from '../../shared';
import DataBackups from './DataBackups';
import Page from './Page';
import PinsCard from './PinsCard';
import styles from './SettingsPage.module.css';
import ThisComputer from './ThisComputer';
import UpdateCard from './UpdateCard';

/** Settings, in DM's single column: This Computer, Data & Backups, Software update, PINs. (The keyboard shortcuts are on LR Entry; the booking station and the company lines are fixed in the app.) */
export default function SettingsPage({ health, seat, onExported }: { health: KeeperHealth; seat: string; onExported: () => void }) {
  return (
    <Page id="settings">
      <div className={styles.column}>
        <ThisComputer seat={seat} />
        <DataBackups health={health} onChanged={onExported} />
        <UpdateCard />
        <PinsCard />
      </div>
    </Page>
  );
}
