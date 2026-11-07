# Bench 2026-11-07 - first

Machine: LAPTOP-B2EDATTK - AMD Ryzen 3 3250U with Radeon Graphics x 4 - 5.9 GB RAM - Windows_NT 10.0.26200 - Node 20.19.4
Database: C:\bmload (copied to a temp folder for the run). Period for the reports and the statement: 2025-11-07 to 2026-11-06.

PASS = every run within the budget. PASS (median; worst over) = the typical run is within it, one run was not. FAIL = the typical run is over.
The first run of a row is included (nothing is thrown away). The OS file cache is warm after the copy: "cold" here means a cold keeper process, not a rebooted PC.
The Electron window's own start (about 1-2 s) is not in the start rows: it is timed by hand in the real window.

| Action | Budget | Runs | Median | Worst | Result |
| --- | --- | --- | --- | --- | --- |
| App start, cold: keeper process start to ready (includes its quick_check and the first backup of the day) | 10 s | 1 | 31340 ms | 31340 ms | FAIL |
| App start, keeper running: health + the first screen's reads | 5 s | 5 | 640 ms | 1324 ms | PASS |
| Type-ahead: the pick-list data (all masters) | 50 ms | 20 | 7.4 ms | 9.8 ms | PASS |
| Type-ahead: rank every firm for what is typed (the screen's own function) | 50 ms | 20 | 0.8 ms | 2.2 ms | PASS |
| Save LR | 150 ms | 20 | 7.3 ms | 18.7 ms | PASS |
| Dashboard open (summary + pending by station + recent) | 300 ms | 20 | 601 ms | 640 ms | FAIL |
| Create memo with 100 LRs | 300 ms | 20 | 21.6 ms | 77.5 ms | PASS |
| Report: date-wise, first page, one year | 1 s | 20 | 223 ms | 253 ms | PASS |
| Report: station-wise, first page, one year | 1 s | 20 | 210 ms | 247 ms | PASS |
| Report: consignor-wise, first page, one year | 1 s | 20 | 378 ms | 830 ms | PASS |
| Report: consignee-wise, first page, one year | 1 s | 20 | 403 ms | 660 ms | PASS |
| Report: truck-wise, first page, one year | 1 s | 20 | 12.2 ms | 24.7 ms | PASS |
| Report: firm-wise, first page, one year | 1 s | 20 | 535 ms | 581 ms | PASS |
| Report: wasuli, first page, one year | 1 s | 20 | 171 ms | 439 ms | PASS |
| Report: the LRs behind a station row, first page, one year | 1 s | 20 | 102 ms | 113 ms | PASS |
| Firm statement, one year, biggest firm (first page and totals) | 1 s | 20 | 92.3 ms | 104 ms | PASS |
| Firm account open, one year, biggest firm (statement + top lists + KPIs + chart together) | 1 s | 5 | 654 ms | 662 ms | PASS |
| History, default filter (last 7 days) | 300 ms | 20 | 11.1 ms | 14.7 ms | PASS |
| Ctrl+K search "1234" | 100 ms | 20 | 3.4 ms | 5.8 ms | PASS |
| Ctrl+K search "sha" | 100 ms | 20 | 2.9 ms | 4.2 ms | PASS |
| Ctrl+K search "traders" | 100 ms | 20 | 2.9 ms | 4.0 ms | PASS |
| Ctrl+K search "MH 29 BE 10" | 100 ms | 20 | 3.2 ms | 3.8 ms | PASS |
| Ctrl+K search "98765" | 100 ms | 20 | 3.2 ms | 4.5 ms | PASS |
| Saves while the full file is backed up (every save during the backup) | 1 s | 402 | 16.7 ms | 3920 ms | PASS (median; worst over) |

- Biggest firm in the year: Shree Agro Traders: 4809 LRs as consignor, 4723 as consignee
- Backup of the full file (export, verified): 11.1 s; 402 saves went through meanwhile
- WAL file after this run's saves: 4.2 MB
- Restore of the full file (compare + fresh backup + swap): 79.3 s (the compare alone 35.2 s)
- Clean stop (final backup + checkpoint): 22.6 s
- Copy of the seeded file into the bench folder: 1.0 s for 458 MB
- Disk used by the bench folder at the end: 2290 MB

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
