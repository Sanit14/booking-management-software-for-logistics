# Bench 2026-11-07 - laptop-b2edattk

Machine: LAPTOP-B2EDATTK - AMD Ryzen 3 3250U with Radeon Graphics x 4 - 5.9 GB RAM - Windows_NT 10.0.26200 - Node 20.19.4
Database: C:\bmload (copied to a temp folder for the run). Period for the reports and the statement: 2025-11-08 to 2026-11-07.

PASS = every run within the budget. PASS (median; worst over) = the typical run is within it, one run was not. FAIL = the typical run is over.
The first run of a row is included (nothing is thrown away). The OS file cache is warm after the copy: "cold" here means a cold keeper process, not a rebooted PC.
The Electron window's own start (about 1-2 s) is not in the start rows: it is timed by hand in the real window.

| Action | Budget | Runs | Median | Worst | Result |
| --- | --- | --- | --- | --- | --- |
| App start, cold: keeper process start to ready (after a clean stop) | 10 s | 1 | 407 ms | 407 ms | PASS |
| App start, keeper running: health + the first screen's reads | 5 s | 5 | 80.8 ms | 184 ms | PASS |
| Type-ahead: the pick-list data (all masters) | 50 ms | 20 | 6.3 ms | 7.3 ms | PASS |
| Type-ahead: rank every firm for what is typed (the screen's own function) | 50 ms | 20 | 0.6 ms | 2.4 ms | PASS |
| Save LR | 150 ms | 20 | 6.5 ms | 18.3 ms | PASS |
| Dashboard open (summary + pending by station + recent) | 300 ms | 20 | 64.7 ms | 68.7 ms | PASS |
| Create memo with 100 LRs | 300 ms | 20 | 22.0 ms | 67.6 ms | PASS |
| Report: date-wise, first page, one year | 1 s | 20 | 212 ms | 220 ms | PASS |
| Report: station-wise, first page, one year | 1 s | 20 | 208 ms | 237 ms | PASS |
| Report: consignor-wise, first page, one year | 1 s | 20 | 377 ms | 621 ms | PASS |
| Report: consignee-wise, first page, one year | 1 s | 20 | 365 ms | 375 ms | PASS |
| Report: truck-wise, first page, one year | 1 s | 20 | 10.9 ms | 17.5 ms | PASS |
| Report: firm-wise, first page, one year | 1 s | 20 | 482 ms | 524 ms | PASS |
| Report: wasuli, first page, one year | 1 s | 20 | 179 ms | 350 ms | PASS |
| Report: the LRs behind a station row, first page, one year | 1 s | 20 | 93.0 ms | 95.2 ms | PASS |
| Firm statement, one year, biggest firm (first page and totals) | 1 s | 20 | 84.9 ms | 96.0 ms | PASS |
| Firm account open, one year, biggest firm (statement + top lists + KPIs + chart together) | 1 s | 5 | 495 ms | 707 ms | PASS |
| History, default filter (last 7 days) | 300 ms | 20 | 8.6 ms | 15.8 ms | PASS |
| Ctrl+K search "1234" | 100 ms | 20 | 3.0 ms | 4.3 ms | PASS |
| Ctrl+K search "sha" | 100 ms | 20 | 2.4 ms | 3.4 ms | PASS |
| Ctrl+K search "traders" | 100 ms | 20 | 2.5 ms | 4.5 ms | PASS |
| Ctrl+K search "MH 29 BE 10" | 100 ms | 20 | 2.4 ms | 3.7 ms | PASS |
| Ctrl+K search "98765" | 100 ms | 20 | 3.4 ms | 5.4 ms | PASS |
| Saves while the full file is backed up (every save during the backup) | 1 s | 1494 | 5.5 ms | 187 ms | PASS |

- First start of a file this keeper has not seen (full check): ready after 13.7 s, first backup of the day done after 21.2 s
- Clean stop after the first start (final backup + checkpoint): 6.7 s
- Same start: first backup of the day finished: 7.8 s after the start (the book is usable before)
- Biggest firm in the year: Shree Agro Traders: 4796 LRs as consignor, 4706 as consignee
- Backup of the full file (export, verified): 12.5 s; 1494 saves went through meanwhile
- Listing the backups (1 here; each is opened and checked, one after the other, on the keeper's thread): 16.1 s
- WAL file after this run's saves: 4.4 MB
- Restore of the full file (compare + fresh backup + swap): 55.4 s (the compare alone 21.2 s)
- Clean stop (final backup + checkpoint): 16.4 s
- Copy of the seeded file into the bench folder: 1.2 s for 458 MB
- Disk used by the bench folder at the end: 2295 MB

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
