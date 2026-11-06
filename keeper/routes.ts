// Every POST route the keeper answers (GET /health and GET /events are served before this list is looked at). One list, so a test can
// hold each route to a rule: the PIN coverage test in server.test.ts fails for a route that is in neither of its two lists.
export const ROUTES: readonly string[] = [
  '/shutdown', '/backups/list', '/restore/preview', '/restore/apply', '/backups/export',
  '/seats', '/pins/setup', '/pins/verify', '/pins/change-system', '/pins/change-admin', '/pins/recover',
  '/masters/all', '/masters/create', '/masters/update', '/masters/set-active',
  '/lrs/defaults', '/lrs/preview', '/lrs/create', '/lrs/by-date', '/settings/set-lr-defaults',
  '/lrs/get', '/lrs/find', '/lrs/update', '/lrs/cancel', '/lrs/restore', '/lrs/history',
  '/dashboard/summary', '/dashboard/pending-by-station', '/dashboard/recent', '/search',
  '/memos/defaults', '/memos/pending', '/memos/totals', '/memos/create', '/memos/get', '/memos/by-date',
  '/memos/list', '/memos/edit', '/memos/remove-lrs', '/memos/move-lrs', '/memos/add-lrs', '/memos/recalculate', '/memos/cancel', '/memos/history',
  '/print/memo', '/print/lr', '/print/done', '/print/company', '/print/set-company', '/print/firm-statement', '/print/report',
  '/wasuli/list', '/wasuli/find', '/wasuli/agent-stats', '/wasuli/assign', '/wasuli/reassign', '/wasuli/to-pool', '/wasuli/collect', '/wasuli/uncollect', '/wasuli/remark',
  '/firms/accounts', '/firms/statement', '/firms/top', '/firms/kpis', '/firms/months',
  '/reports/date-wise', '/reports/station-wise', '/reports/party-wise', '/reports/truck-wise', '/reports/firm-wise', '/reports/wasuli', '/reports/lrs',
  '/history/list',
  '/settings/update-start', '/settings/set-backup-dir', '/seats/rename',
];
