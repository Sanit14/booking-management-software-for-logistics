import type { Jump } from '../logic/searchResults';
import { strings } from '../strings';
import Dialog from '../ui/Dialog';
import GlobalSearch from './GlobalSearch';

/** The Ctrl+K window, from any page. The box inside starts empty every time (the dialog mounts it only while open). */
export default function SearchOverlay({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (jump: Jump) => void }) {
  return (
    <Dialog open={open} wide title={strings.search.title} cancelLabel={strings.search.close} onCancel={onClose}>
      <GlobalSearch
        onPick={(jump) => {
          onClose();
          onPick(jump);
        }}
      />
    </Dialog>
  );
}
