import path from 'node:path';

// Shared by every Windows user on the host (unlike %APPDATA%), so all seats and the keeper agree.
// PROGRAMDATA can be overridden in tests.
export function programDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(env.PROGRAMDATA || 'C:\\ProgramData', 'BookingManager');
}

export const pointerPath = (programDirPath: string): string => path.join(programDirPath, 'root.json');
export const logPath = (programDirPath: string): string => path.join(programDirPath, 'logs', 'keeper.log');
