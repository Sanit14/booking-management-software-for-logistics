// What the screen and main agree on for the seat's own keyboard shortcuts: the actions, their default keys and the API.
// Types and fixed constants only; the rules (what a key may be, matching, checking a file) are in src/logic/keymap.ts.

export const ACTIONS = ['saveLr', 'newLr', 'quickLr', 'goLrEntry', 'goLoadingMemo', 'goDashboard', 'focusLrSearch', 'globalSearch'] as const;
export type ActionId = (typeof ACTIONS)[number];
/** A key is a string: "F4", "Ctrl+Q", "Alt+7", and "Escape" (a default only). */
export type Keymap = Record<ActionId, string>;

export const DEFAULT_KEYS: Keymap = {
  saveLr: 'F4',
  newLr: 'Escape',
  quickLr: 'F2',
  goLrEntry: 'F3',
  goLoadingMemo: 'F5',
  goDashboard: 'F1',
  focusLrSearch: 'Ctrl+F',
  globalSearch: 'Ctrl+K',
};

export interface KeysApi {
  /** This seat's keys: its file, or the defaults. */
  get(): Promise<Keymap>;
  /** Saves this seat's keys; answers with the keys now in force (main checks them again, a bad set becomes the defaults). */
  set(keys: Keymap): Promise<Keymap>;
}
