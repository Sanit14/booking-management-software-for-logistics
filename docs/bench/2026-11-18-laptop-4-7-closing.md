# Bench 2026-11-18 - laptop-4-7-closing

Machine: LAPTOP-B2EDATTK - AMD Ryzen 3 3250U with Radeon Graphics x 4 - 5.9 GB RAM - Windows_NT 10.0.26200 - Node 20.19.4
Database: C:\bmload45 (copied to a temp folder for the run). Period for the reports and the statement: 2025-11-19 to 2026-11-18.

PASS = every run within the budget. PASS (median; worst over) = the typical run is within it, one run was not. FAIL = the typical run is over.
The first run of a row is included (nothing is thrown away). The OS file cache is warm after the copy: "cold" here means a cold keeper process, not a rebooted PC.
The Electron window's own start (about 1-2 s) is not in the start rows: it is timed by hand in the real window.

| Action | Budget | Runs | Median | Worst | Result |
| --- | --- | --- | --- | --- | --- |
| App start, cold: keeper process start to ready (after a clean stop) | 10 s | 1 | 417 ms | 417 ms | PASS |
| App start, keeper running: health + the first screen's reads | 5 s | 5 | 67.8 ms | 177 ms | PASS |
| Type-ahead: the pick-list data (all masters) | 50 ms | 20 | 6.0 ms | 12.5 ms | PASS |
| Type-ahead: rank every firm for what is typed (the screen's own function) | 50 ms | 20 | 0.5 ms | 1.7 ms | PASS |
| Save LR | 150 ms | 20 | 7.1 ms | 22.6 ms | PASS |
| Dashboard open (summary + pending by station + recent) | 300 ms | 20 | 63.5 ms | 110 ms | PASS |
| New memo: pending list, one To station, first page | 100 ms | 20 | 4.3 ms | 23.3 ms | PASS |
| New memo: station list with counts | 100 ms | 20 | 7.4 ms | 9.6 ms | PASS |
| New memo: name search, 3 letters, every pending LR | 300 ms | 20 | 221 ms | 682 ms | PASS (median; worst over) |
| Create memo with 100 LRs | 300 ms | 20 | 21.8 ms | 65.0 ms | PASS |
| Report: date-wise, first page, one year | 1 s | 20 | 111 ms | 120 ms | PASS |
| Report: station-wise, first page, one year | 1 s | 20 | 155 ms | 174 ms | PASS |
| Report: consignor-wise, first page, one year | 1 s | 20 | 285 ms | 524 ms | PASS |
| Report: consignee-wise, first page, one year | 1 s | 20 | 296 ms | 344 ms | PASS |
| Report: truck-wise, first page, one year | 1 s | 20 | 10.6 ms | 18.8 ms | PASS |
| Report: firm-wise, first page, one year | 1 s | 20 | 380 ms | 1172 ms | PASS (median; worst over) |
| Report: wasuli, first page, one year | 1 s | 20 | 134 ms | 509 ms | PASS |
| Report: the LRs behind a station row, first page, one year | 1 s | 20 | 72.7 ms | 83.0 ms | PASS |
| Firm statement, one year, biggest firm (first page and totals) | 1 s | 20 | 63.5 ms | 80.5 ms | PASS |
| Firm account open, one year, biggest firm (statement + top lists + KPIs + chart together) | 1 s | 5 | 362 ms | 564 ms | PASS |
| History, default filter (last 7 days) | 300 ms | 20 | 7.4 ms | 11.1 ms | PASS |
| Ctrl+K search "1234" | 100 ms | 20 | 2.5 ms | 4.8 ms | PASS |
| Ctrl+K search "sha" | 100 ms | 20 | 2.3 ms | 2.9 ms | PASS |
| Ctrl+K search "traders" | 100 ms | 20 | 2.1 ms | 3.2 ms | PASS |
| Ctrl+K search "MH 29 BE 10" | 100 ms | 20 | 2.1 ms | 3.2 ms | PASS |
| Ctrl+K search "98765" | 100 ms | 20 | 2.1 ms | 3.1 ms | PASS |
| Saves while the full file is backed up (every save during the backup) | 1 s | 1573 | 6.4 ms | 180 ms | PASS |
| Saves while the backups are listed | 1 s | 2 | 7.3 ms | 7.3 ms | PASS |
| Health pings while the backups are listed | 1 s | 1 | 6.5 ms | 6.5 ms | PASS |
| Saves while a backup is previewed | 1 s | 3325 | 6.7 ms | 344 ms | PASS |
| Health pings while a backup is previewed | 1 s | 257 | 8.1 ms | 324 ms | PASS |
| Saves while a restore runs (check, fresh backup, swap) | 1 s | 4847 | 6.8 ms | 392 ms | PASS |
| Health pings while a restore runs (check, fresh backup, swap) | 1 s | 340 | 8.4 ms | 348 ms | PASS |

- First start of a file this keeper has not seen (full check): ready after 24.5 s, first backup of the day done after 24.5 s
- Clean stop after the first start (final backup + checkpoint): 7.5 s
- Same start: first backup of the day finished: 10.1 s after the start (the book is usable before)
- Biggest firm in the year: Shree Agro Traders: 4638 LRs as consignor, 4736 as consignee
- Backup of the full file (export, verified): 16.4 s; 1573 saves went through meanwhile
- Listing the backups (1 here; names, times and sizes only, nothing is opened): 113 ms
- WAL file after this run's saves: 4.2 MB
- Restore of the full file (compare, then check + fresh backup + swap): 69.4 s (the compare alone 30.0 s)
- Clean stop (final backup + checkpoint): 13.0 s
- Copy of the seeded file into the bench folder: 0.8 s for 447 MB
- Disk used by the bench folder at the end: 1802 MB

## Seeded database

```
root: C:\bmload45
days: 1096
perDay: 300
end: 2026-11-12
lrs: {"booked":23114,"cancelled":5947,"loaded":265187}
memos: {"cancelled":99,"saved":19745}
wasuli: {"assigned":17498,"collected":69096,"unassigned":54}
firms: 400
stations: 40
trucks: 60
drivers: 30
agents: 8
auditRows: 577145
auditTriggers: 2
firstDate: 2023-11-13
lastDate: 2026-11-12
biggestFirm: {"id":1,"n":14326}
made: {"lrs":294248,"cancelled":5947,"edited":9021,"memos":19844,"memoEdits":189,"memosCancelled":99,"assigned":86594,"collected":69096,"refused":0,"why":{}}
integrity: ok
integrityMs: 25717
fileMB: 447
vacuumSeconds: 19.7
minutes: 12.4
```
