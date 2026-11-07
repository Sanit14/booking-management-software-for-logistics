// A process of its own that checks one backup file (see verifyBackup in backup.ts) and prints its summary as JSON, or null when it fails.
import { readSummary } from './backup';

if (require.main === module) process.stdout.write(JSON.stringify(readSummary(process.argv[2] ?? '')));
