// The BM_* environment variables (a short PIN lock, another backup folder, a quick marker refresh) exist for tests and the bench. The keeper is shared by
// every seat and starts with the environment of whichever Windows user opened the app first, so a variable alone must never change it: a hook
// works only when the keeper was started with --test-hooks. The tests and the bench pass that argument; the app passes it only in a dev run.
export const TEST_HOOKS_ARG = '--test-hooks';

export function testHook(argv: readonly string[], env: NodeJS.ProcessEnv, name: string): string | undefined {
  return argv.includes(TEST_HOOKS_ARG) ? env[name] : undefined;
}
