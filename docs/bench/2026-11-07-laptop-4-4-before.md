# Bench 2026-11-07 - laptop-4-4-before

Machine: LAPTOP-B2EDATTK - AMD Ryzen 3 3250U with Radeon Graphics x 4 - 5.9 GB RAM - Windows_NT 10.0.26200 - Node 20.19.4
Database: C:\bmload (copied to a temp folder for the run). Period for the reports and the statement: 2025-11-08 to 2026-11-07.

PASS = every run within the budget. PASS (median; worst over) = the typical run is within it, one run was not. FAIL = the typical run is over.
The first run of a row is included (nothing is thrown away). The OS file cache is warm after the copy: "cold" here means a cold keeper process, not a rebooted PC.
The Electron window's own start (about 1-2 s) is not in the start rows: it is timed by hand in the real window.

| Action | Budget | Runs | Median | Worst | Result |
| --- | --- | --- | --- | --- | --- |
| App start, cold: keeper process start to ready (after a clean stop) | 10 s | 1 | 508 ms | 508 ms | PASS |
| App start, keeper running: health + the first screen's reads | 5 s | 5 | 88.3 ms | 158 ms | PASS |
| Type-ahead: the pick-list data (all masters) | 50 ms | 20 | 8.0 ms | 12.9 ms | PASS |
| Type-ahead: rank every firm for what is typed (the screen's own function) | 50 ms | 20 | 0.6 ms | 2.8 ms | PASS |
| Save LR | 150 ms | 20 | 9.2 ms | 31.9 ms | PASS |
| Dashboard open (summary + pending by station + recent) | 300 ms | 20 | 69.3 ms | 89.8 ms | PASS |
| Create memo with 100 LRs | 300 ms | 20 | 31.7 ms | 114 ms | PASS |
| Report: date-wise, first page, one year | 1 s | 20 | 228 ms | 256 ms | PASS |
| Report: station-wise, first page, one year | 1 s | 20 | 225 ms | 296 ms | PASS |
| Report: consignor-wise, first page, one year | 1 s | 20 | 402 ms | 533 ms | PASS |
| Report: consignee-wise, first page, one year | 1 s | 20 | 427 ms | 1106 ms | PASS (median; worst over) |
| Report: truck-wise, first page, one year | 1 s | 20 | 12.2 ms | 22.0 ms | PASS |
| Report: firm-wise, first page, one year | 1 s | 20 | 707 ms | 895 ms | PASS |
| Report: wasuli, first page, one year | 1 s | 20 | 182 ms | 335 ms | PASS |
| Report: the LRs behind a station row, first page, one year | 1 s | 20 | 106 ms | 148 ms | PASS |
| Firm statement, one year, biggest firm (first page and totals) | 1 s | 20 | 93.8 ms | 104 ms | PASS |
| Firm account open, one year, biggest firm (statement + top lists + KPIs + chart together) | 1 s | 5 | 547 ms | 574 ms | PASS |
| History, default filter (last 7 days) | 300 ms | 20 | 12.3 ms | 16.5 ms | PASS |
| Ctrl+K search "1234" | 100 ms | 20 | 5.0 ms | 8.2 ms | PASS |
| Ctrl+K search "sha" | 100 ms | 20 | 4.5 ms | 5.5 ms | PASS |
| Ctrl+K search "traders" | 100 ms | 20 | 3.7 ms | 5.8 ms | PASS |
| Ctrl+K search "MH 29 BE 10" | 100 ms | 20 | 4.1 ms | 5.2 ms | PASS |
| Ctrl+K search "98765" | 100 ms | 20 | 3.8 ms | 5.1 ms | PASS |
| Saves while the full file is backed up (every save during the backup) | 1 s | 1075 | 9.3 ms | 463 ms | PASS |
| Saves while the backups are listed | 1 s | 2 | 21588 ms | 21588 ms | FAIL |
| Health pings while the backups are listed | 1 s | 2 | 21486 ms | 21486 ms | FAIL |
| Saves while a backup is previewed | 1 s | 2 | 28048 ms | 28048 ms | FAIL |
| Health pings while a backup is previewed | 1 s | 2 | 27932 ms | 27932 ms | FAIL |
| Saves while a restore runs (check, fresh backup, swap) | 1 s | 1172 | 8.6 ms | 24021 ms | PASS (median; worst over) |
| Health pings while a restore runs (check, fresh backup, swap) | 1 s | 128 | 14.2 ms | 23906 ms | PASS (median; worst over) |

- First start of a file this keeper has not seen (full check): ready after 18.3 s, first backup of the day done after 27.1 s
- Clean stop after the first start (final backup + checkpoint): 8.7 s
- Same start: first backup of the day finished: 8.6 s after the start (the book is usable before)
- Biggest firm in the year: Shree Agro Traders: 4796 LRs as consignor, 4706 as consignee
- Backup of the full file (export, verified): 15.9 s; 1075 saves went through meanwhile
- Listing the backups (1 here; names, times and sizes only, nothing is opened): 21711 ms
- WAL file after this run's saves: 4.4 MB
- Restore of the full file (compare, then check + fresh backup + swap): 89.3 s (the compare alone 28.2 s)
- Clean stop (final backup + checkpoint): 15.8 s
- Copy of the seeded file into the bench folder: 1.8 s for 458 MB
- Disk used by the bench folder at the end: 1836 MB

## Seeded database

```
root: C:\bmload
days: 1096
perDay: 300
end: 2026-11-06
lrs: {"booked":23291,"cancelled":5803,"loaded":266740}
memos: {"cancelled":96,"saved":19713}
wasuli: {"assigned":17297,"collected":69651,"unassigned":138}
firms: 400
stations: 40
trucks: 60
drivers: 30
agents: 8
auditRows: 579694
auditTriggers: 2
firstDate: 2023-11-07
lastDate: 2026-11-06
biggestFirm: {"id":1,"n":14597}
made: {"lrs":295834,"cancelled":5803,"edited":8901,"memos":19809,"memoEdits":193,"memosCancelled":96,"assigned":86948,"collected":69651,"refused":0,"why":{}}
integrity: ok
integrityMs: 23769
fileMB: 458
vacuumSeconds: 28.2
minutes: 19.3
```
