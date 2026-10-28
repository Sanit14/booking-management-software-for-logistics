// What the screen and main agree on for in-app updates. Types only; every sentence the person reads is in src/strings.ts.

/** The Settings → Software update card shows exactly one of these. */
export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'uptodate' }
  | { status: 'available'; version: string; sizeBytes: number }
  | { status: 'downloading'; version: string; percent: number; verifying: boolean }
  | { status: 'downloaded'; version: string; notice?: string } // notice: why the last install attempt stopped
  | { status: 'installing'; version: string; step: number }
  | { status: 'error'; message: string };

/** `wrongPin`: the Admin PIN was not accepted (the dots shake); any other refusal comes with its explanation. */
export type UpdateInstallResult = { ok: true } | { ok: false; wrongPin: boolean; message: string };

export interface UpdateApi {
  state(): Promise<UpdateState>;
  /** Calls back on every change of state. Returns the function that stops listening. */
  onState(callback: (state: UpdateState) => void): () => void;
  check(): Promise<UpdateState>;
  download(): Promise<UpdateState>;
  /** The Admin PIN goes to main, which has the keeper check it; the screen never decides. */
  install(adminPin: string): Promise<UpdateInstallResult>;
}
