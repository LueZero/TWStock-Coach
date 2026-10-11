-- Additive migration: existing stock-intelligent-assistant volume stays intact.
CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS bars(
 id serial PRIMARY KEY,market varchar(8) NOT NULL,symbol varchar(16) NOT NULL,session varchar(24) NOT NULL,timeframe varchar(8) NOT NULL,price_basis varchar(16) NOT NULL,
 timestamp timestamptz NOT NULL,trade_date date NOT NULL,open float8 NOT NULL,high float8 NOT NULL,low float8 NOT NULL,close float8 NOT NULL,volume bigint NOT NULL,
 source_volume_unit varchar(16) NOT NULL,source varchar(64) NOT NULL,source_time timestamptz NOT NULL,received_at timestamptz NOT NULL,is_final boolean NOT NULL,revision integer NOT NULL,payload json NOT NULL,
 CONSTRAINT bar_key UNIQUE(market,symbol,session,timeframe,price_basis,timestamp));
CREATE INDEX IF NOT EXISTS ix_bars_series_date ON bars(market,symbol,session,timeframe,price_basis,trade_date);
CREATE TABLE IF NOT EXISTS bar_revisions(id serial PRIMARY KEY,bar_id integer NOT NULL,revision integer NOT NULL,replaced_at timestamptz NOT NULL,snapshot json NOT NULL);
CREATE TABLE IF NOT EXISTS analysis(bar_id integer PRIMARY KEY,bar_revision integer NOT NULL,
 ma5 float8,ma10 float8,ma20 float8,ma60 float8,ma120 float8,ma240 float8,rsi14 float8,macd float8,macd_signal float8,macd_histogram float8,atr14 float8,bb_upper float8,bb_lower float8,volume_ratio float8,k float8,d float8,
 advice varchar(1000) NOT NULL,status varchar(64) NOT NULL,version varchar(32) NOT NULL,computed_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS job_runs(id serial PRIMARY KEY,name varchar(128) NOT NULL,status varchar(32) NOT NULL,started_at timestamptz NOT NULL,finished_at timestamptz,details json NOT NULL);
CREATE INDEX IF NOT EXISTS ix_job_runs_queue ON job_runs(status,started_at);
CREATE TABLE IF NOT EXISTS instruments(id serial PRIMARY KEY,market varchar(8) NOT NULL,symbol varchar(16) NOT NULL,name varchar(128) NOT NULL,industry varchar(128) NOT NULL,updated_at timestamptz NOT NULL,CONSTRAINT instrument_key UNIQUE(market,symbol));
CREATE TABLE IF NOT EXISTS fundamental_snapshots(id serial PRIMARY KEY,market varchar(8) NOT NULL,symbol varchar(16) NOT NULL,dataset varchar(64) NOT NULL,source varchar(64) NOT NULL,received_at timestamptz NOT NULL,digest varchar(64) NOT NULL,revision integer NOT NULL,data json NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS fundamental_revision_key ON fundamental_snapshots(market,symbol,dataset,revision);
CREATE INDEX IF NOT EXISTS ix_fundamental_lookup ON fundamental_snapshots(market,symbol,received_at,id);
CREATE TABLE IF NOT EXISTS quote_snapshots(id serial PRIMARY KEY,market varchar(8) NOT NULL,symbol varchar(16) NOT NULL,source_time timestamptz NOT NULL,trade_date date NOT NULL,received_at timestamptz NOT NULL,data json NOT NULL,CONSTRAINT quote_key UNIQUE(market,symbol,source_time));
INSERT INTO schema_migrations(version) VALUES(1) ON CONFLICT DO NOTHING;
ALTER TABLE job_runs ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}';
ALTER TABLE job_runs ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz;
ALTER TABLE job_runs ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
ALTER TABLE job_runs ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 10;
CREATE TABLE IF NOT EXISTS market_board_snapshots(
 id bigserial PRIMARY KEY, source_key varchar(128) NOT NULL, digest varchar(64) NOT NULL,
 received_at timestamptz NOT NULL, data jsonb NOT NULL,
 CONSTRAINT market_board_snapshot_key UNIQUE(source_key,digest));
CREATE INDEX IF NOT EXISTS ix_market_board_lookup ON market_board_snapshots(source_key,received_at DESC,id DESC);
-- Preserve the first immutable content capture and track its latest observation.
ALTER TABLE market_board_snapshots ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
UPDATE market_board_snapshots SET last_seen_at=received_at WHERE last_seen_at IS NULL;
ALTER TABLE market_board_snapshots ALTER COLUMN last_seen_at SET NOT NULL;
CREATE INDEX IF NOT EXISTS ix_market_board_observed ON market_board_snapshots(source_key,last_seen_at DESC,id DESC);
