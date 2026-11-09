# Bench 2026-11-09 - laptop-4-4-closing

Machine: LAPTOP-B2EDATTK - AMD Ryzen 3 3250U with Radeon Graphics x 4 - 5.9 GB RAM - Windows_NT 10.0.26200 - Node 20.19.4
Database: C:\bmload (copied to a temp folder for the run). Period for the reports and the statement: 2025-11-10 to 2026-11-09.

PASS = every run within the budget. PASS (median; worst over) = the typical run is within it, one run was not. FAIL = the typical run is over.
The first run of a row is included (nothing is thrown away). The OS file cache is warm after the copy: "cold" here means a cold keeper process, not a rebooted PC.
The Electron window's own start (about 1-2 s) is not in the start rows: it is timed by hand in the real window.

| Action | Budget | Runs | Median | Worst | Result |
| --- | --- | --- | --- | --- | --- |
| App start, cold: keeper process start to ready (after a clean stop) | 10 s | 1 | 414 ms | 414 ms | PASS |
| App start, keeper running: health + the first screen's reads | 5 s | 5 | 61.1 ms | 157 ms | PASS |
| Type-ahead: the pick-list data (all masters) | 50 ms | 20 | 5.7 ms | 6.9 ms | PASS |
| Type-ahead: rank every firm for what is typed (the screen's own function) | 50 ms | 20 | 0.4 ms | 1.4 ms | PASS |
| Save LR | 150 ms | 20 | 6.8 ms | 15.8 ms | PASS |
| Dashboard open (summary + pending by station + recent) | 300 ms | 20 | 55.3 ms | 62.4 ms | PASS |
| Create memo with 100 LRs | 300 ms | 20 | 22.8 ms | 61.2 ms | PASS |
| Report: date-wise, first page, one year | 1 s | 20 | 175 ms | 182 ms | PASS |
| Report: station-wise, first page, one year | 1 s | 20 | 167 ms | 258 ms | PASS |
| Report: consignor-wise, first page, one year | 1 s | 20 | 290 ms | 514 ms | PASS |
| Report: consignee-wise, first page, one year | 1 s | 20 | 288 ms | 359 ms | PASS |
| Report: truck-wise, first page, one year | 1 s | 20 | 9.3 ms | 15.5 ms | PASS |
| Report: firm-wise, first page, one year | 1 s | 20 | 390 ms | 432 ms | PASS |
| Report: wasuli, first page, one year | 1 s | 20 | 129 ms | 333 ms | PASS |
| Report: the LRs behind a station row, first page, one year | 1 s | 20 | 76.8 ms | 89.3 ms | PASS |
| Firm statement, one year, biggest firm (first page and totals) | 1 s | 20 | 67.6 ms | 75.8 ms | PASS |
| Firm account open, one year, biggest firm (statement + top lists + KPIs + chart together) | 1 s | 5 | 378 ms | 402 ms | PASS |
| History, default filter (last 7 days) | 300 ms | 20 | 6.9 ms | 11.7 ms | PASS |
| Ctrl+K search "1234" | 100 ms | 20 | 2.6 ms | 5.0 ms | PASS |
| Ctrl+K search "sha" | 100 ms | 20 | 2.3 ms | 4.8 ms | PASS |
| Ctrl+K search "traders" | 100 ms | 20 | 1.9 ms | 3.6 ms | PASS |
| Ctrl+K search "MH 29 BE 10" | 100 ms | 20 | 2.1 ms | 3.1 ms | PASS |
| Ctrl+K search "98765" | 100 ms | 20 | 2.2 ms | 3.1 ms | PASS |
| Saves while the full file is backed up (every save during the backup) | 1 s | 1412 | 6.0 ms | 200 ms | PASS |
| Saves while the backups are listed | 1 s | 2 | 7.2 ms | 7.2 ms | PASS |
| Health pings while the backups are listed | 1 s | 1 | 7.6 ms | 7.6 ms | PASS |
| Saves while a backup is previewed | 1 s | 4138 | 6.5 ms | 186 ms | PASS |
| Health pings while a backup is previewed | 1 s | 251 | 7.3 ms | 98.5 ms | PASS |
| Saves while a restore runs (check, fresh backup, swap) | 1 s | 4858 | 6.5 ms | 411 ms | PASS |
| Health pings while a restore runs (check, fresh backup, swap) | 1 s | 319 | 8.1 ms | 298 ms | PASS |

- First start of a file this keeper has not seen (full check): ready after 15.1 s, first backup of the day done after 23.6 s
- Clean stop after the first start (final backup + checkpoint): 7.3 s
- Same start: first backup of the day finished: 7.6 s after the start (the book is usable before)
- Biggest firm in the year: Shree Agro Traders: 4775 LRs as consignor, 4692 as consignee
- Backup of the full file (export, verified): 13.2 s; 1412 saves went through meanwhile
- Listing the backups (1 here; names, times and sizes only, nothing is opened): 111 ms
- WAL file after this run's saves: 4.4 MB
- Restore of the full file (compare, then check + fresh backup + swap): 64.6 s (the compare alone 27.5 s)
- Clean stop (final backup + checkpoint): 14.1 s
- Copy of the seeded file into the bench folder: 0.8 s for 458 MB
- Disk used by the bench folder at the end: 1845 MB

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
