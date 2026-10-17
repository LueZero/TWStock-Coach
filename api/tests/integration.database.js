// Read-only against public data; all fixtures live in transaction-local temp tables.
import test from "node:test";
import assert from "node:assert/strict";
import { pool, normalize } from "../db.js";
import { reportBars } from "../report-bars.js";
import { saveQuote, quoteAt } from "../quote-store.js";
import { calculate } from "../indicators.js";

test("真實 PostgreSQL：完整年度區間暖機、截止前修訂、行情首次接收與修訂重現", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`CREATE TEMP TABLE bars(id serial,market text,symbol text,session text,timeframe text,price_basis text,timestamp timestamptz,trade_date date,open float8,high float8,low float8,close float8,volume bigint,received_at timestamptz,source_time timestamptz,revision int,is_final boolean) ON COMMIT DROP;
      CREATE TEMP TABLE bar_revisions(bar_id int,revision int,snapshot jsonb) ON COMMIT DROP;
      CREATE TEMP TABLE quote_snapshots(id serial,market text,symbol text,source_time timestamptz,trade_date date,received_at timestamptz,data json) ON COMMIT DROP;
      CREATE TEMP TABLE quote_revisions(id serial,snapshot_id int,replaced_at timestamptz,snapshot jsonb) ON COMMIT DROP;`);
    await client.query(`INSERT INTO bars(market,symbol,session,timeframe,price_basis,timestamp,trade_date,open,high,low,close,volume,received_at,source_time,revision,is_final)
      SELECT 'TWSE','2883','daily_aggregate','1d','raw', d::date+'13:30+08'::timetz,d::date,30,31,29,30+(extract(doy from d)::int%30)/10.0,1000,
      d::date+'14:30+08'::timetz,d::date+'13:30+08'::timetz,1,true FROM generate_series('2024-01-01'::timestamp,'2026-10-12'::timestamp,interval '1 day') d WHERE extract(isodow from d)<=5`);
    const q = {
      market: "TWSE",
      symbol: "2883",
      start: "2025-10-13",
      end: "2026-10-12",
      as_of: "2026-10-12T15:00:00Z",
    };
    const read = async (sql, args) =>
      normalize((await client.query(sql, args)).rows);
    const bars = await reportBars(q, read);
    assert.ok(bars.length > 500);
    const first = calculate(bars).find((b) => b.trade_date >= q.start);
    assert.ok(first.ma240 > 0, "區間第一根MA240也需有暖機");
    const reference = normalize(
      (
        await client.query(
          "SELECT * FROM bars WHERE trade_date BETWEEN $1::date-480 AND $2 ORDER BY timestamp",
          [q.start, q.end],
        )
      ).rows,
    );
    assert.equal(
      first.ma240,
      calculate(reference).find((b) => b.trade_date >= q.start).ma240,
    );
    assert.equal(
      calculate(bars.slice(-320)).find((b) => b.trade_date >= q.start).ma240,
      null,
      "重現舊320根上限的缺陷",
    );
    await client.query(
      "INSERT INTO bar_revisions SELECT id,revision,to_jsonb(b) FROM bars b WHERE trade_date=$1",
      [q.end],
    );
    const before = bars.at(-1).close;
    await client.query(
      "UPDATE bars SET close=9000,revision=2,received_at='2026-10-13T15:00Z' WHERE trade_date=$1",
      [q.end],
    );
    assert.equal(
      (await reportBars(q, read)).at(-1).close,
      before,
      "不能讀到截止後修訂",
    );
    const quote = {
      market: "TWSE",
      symbol: "2883",
      source_time: "2026-10-12T05:30:00Z",
      trade_date: q.end,
      received_at: "2026-10-12T05:31:00Z",
      last_price: 38.8,
    };
    await saveQuote(client, quote);
    await saveQuote(client, { ...quote, received_at: "2026-10-12T05:32:00Z" });
    assert.equal(
      (await quoteAt("TWSE", "2883", "2026-10-12T05:31:30Z", read)).data
        .last_price,
      38.8,
    );
    await saveQuote(client, {
      ...quote,
      received_at: "2026-10-12T05:33:00Z",
      last_price: 38.85,
    });
    assert.equal(
      (await quoteAt("TWSE", "2883", "2026-10-12T05:32:30Z", read)).data
        .last_price,
      38.8,
    );
    assert.equal(
      (await quoteAt("TWSE", "2883", "2026-10-12T05:34:00Z", read)).data
        .last_price,
      38.85,
    );
    assert.equal(
      await quoteAt("TWSE", "2883", "2026-10-12T05:30:30Z", read),
      undefined,
    );
    assert.equal(
      Number(
        (await client.query("SELECT count(*) AS n FROM quote_revisions"))
          .rows[0].n,
      ),
      1,
    );
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
