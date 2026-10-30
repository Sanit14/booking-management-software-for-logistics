// The one search box: a few LRs, firms, trucks and stations for what was typed. Fixed lookups, each `LIMIT 5`, never a
// generic query. The LR number, the firm / station prefix and the year are index searches (dbtest checks the plans);
// "contains" on firms and trucks reads only those small master tables, never lrs. Reads only: nothing is logged, the
// text may be a name.
import type { KeeperResult, SearchAnswer, SearchFirm, SearchLr, SearchStation, SearchTruck } from '../shared';
import type { Db } from './db';
import { localDate } from './lrRules';
import { truckKey } from './masterRules';
import { nameKey } from './names';

const LIMIT = 5;
const MAX_TEXT = 100;
// Above every character a key can hold, so `name_key >= k AND name_key < k + HIGH` is "starts with k" on the index.
const HIGH = '\u{10FFFF}';

export const SEARCH_SQL = {
  lr: `SELECT l.id, l.lr_no AS lrNo, l.lr_year AS lrYear, l.lr_date AS date, l.consignee_name AS consignee, s.name AS toStation, l.status
       FROM lrs l JOIN stations s ON s.id = l.to_station_id WHERE l.lr_year = ? AND l.lr_no = ?`,
  firmPrefix: `SELECT f.id, f.name, s.name AS station, f.active FROM firms f LEFT JOIN stations s ON s.id = f.station_id
       WHERE f.name_key >= @k AND f.name_key < @hi ORDER BY f.name_key LIMIT @n`,
  // instr, not LIKE: no escaping of % and _, and "> 1" leaves out the names the prefix lookup already gave.
  firmContains: `SELECT f.id, f.name, s.name AS station, f.active FROM firms f LEFT JOIN stations s ON s.id = f.station_id
       WHERE instr(f.name_key, @k) > 1 ORDER BY f.name_key LIMIT @n`,
  truck: `SELECT id, number, active FROM trucks WHERE instr(number_key, @k) > 0 ORDER BY instr(number_key, @k), number_key LIMIT ${LIMIT}`,
  station: `SELECT id, name, active FROM stations WHERE name_key >= @k AND name_key < @hi ORDER BY name_key LIMIT ${LIMIT}`,
};

/** A row as SQLite gives it: `active` is 0 or 1. */
type Raw<T> = Omit<T, 'active'> & { active: number };
const flag = <T extends { active: boolean }>(rows: Raw<T>[]): T[] => rows.map((r) => ({ ...r, active: r.active === 1 }) as T);

export function search(db: Db, text: string, now: () => Date = () => new Date()): KeeperResult<SearchAnswer> {
  const typed = text.trim().slice(0, MAX_TEXT);
  const answer: SearchAnswer = { lrs: [], firms: [], trucks: [], stations: [] };
  if (typed === '') return { ok: true, value: answer };

  // An LR number: this year's first, then last year's (the numbers restart every 1 January).
  if (/^\d{1,9}$/.test(typed)) {
    const year = Number(localDate(now()).slice(0, 4));
    const lr = db.prepare(SEARCH_SQL.lr);
    for (const y of [year, year - 1]) answer.lrs.push(...(lr.all(y, Number(typed)) as SearchLr[]));
  }

  const key = nameKey(typed);
  const range = { k: key, hi: key + HIGH };
  const firms = flag<SearchFirm>(db.prepare(SEARCH_SQL.firmPrefix).all({ ...range, n: LIMIT }) as Raw<SearchFirm>[]);
  if (firms.length < LIMIT) {
    firms.push(...flag<SearchFirm>(db.prepare(SEARCH_SQL.firmContains).all({ k: key, n: LIMIT - firms.length }) as Raw<SearchFirm>[]));
  }
  answer.firms = firms;

  const truck = truckKey(typed);
  if (truck !== '') answer.trucks = flag<SearchTruck>(db.prepare(SEARCH_SQL.truck).all({ k: truck }) as Raw<SearchTruck>[]);
  answer.stations = flag<SearchStation>(db.prepare(SEARCH_SQL.station).all(range) as Raw<SearchStation>[]);
  return { ok: true, value: answer };
}
