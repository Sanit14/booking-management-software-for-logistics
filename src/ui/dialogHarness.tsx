// A page for `electron/dialog.electrontest.ts` only: nothing in the app imports it and it is not shipped (the Vite build starts from index.html).
// It nests real `Dialog`s the way MemoView does (the windows of a saved memo are children of the memo's own dialog), so a real Escape can be
// sent to them in a real Electron window.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import Dialog from './Dialog';
import PinDialog from './PinDialog';

function Harness() {
  const [outer, setOuter] = useState(false);
  const [inner, setInner] = useState(false);
  const [pin, setPin] = useState(false);
  return (
    <>
      <button id="open-outer" onClick={() => setOuter(true)}>
        Open outer
      </button>
      <Dialog open={outer} title="Outer" onCancel={() => setOuter(false)}>
        <button id="open-inner" onClick={() => setInner(true)}>
          Open inner
        </button>
        <Dialog open={inner} title="Inner" onCancel={() => setInner(false)}>
          <button id="open-pin" data-autofocus="" onClick={() => setPin(true)}>
            Open PIN
          </button>
          <PinDialog open={pin} title="PIN" onCancel={() => setPin(false)} onSubmit={() => false} />
        </Dialog>
      </Dialog>
    </>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<Harness />);
