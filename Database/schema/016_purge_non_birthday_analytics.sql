-- Keep the warehouse for jaytibirthday.in only.
--
-- The operator console at jaytipargal.tech tracked itself: every visit to
-- the console, and every device probe the fleet made against it, was
-- recorded as a visit to that domain. The visitor panels then read as
-- traffic that was never anybody's — the owner's own sessions and the fleet's
-- own probes. The owner asked for the other domains' data to be removed
-- completely rather than merely hidden.
--
-- The delete is by property, not by name: every row whose site is not the
-- tracked one goes, including the mis-attributed hosts the allow-list used
-- to let through (`*.v0.build`, `*.vercel.run`, a device id filed as a
-- website).
--
-- `sessions` and `visitors` are rollups over `events` and are keyed by
-- (site, id). They go with the events: an upsert never removes a row, so
-- leaving them would keep the deleted domains visible in the sessions panel
-- even after their events were gone.
--
-- The three tables are the SIBLING repository's (001-003 create them), so a
-- database that has only this repository's migrations has no such tables and
-- the delete has nothing to do. The DO block checks before it deletes: a
-- migration that fails on a fresh database is a migration that cannot be
-- proven, and a proof that cannot run is not a proof.
--
-- Idempotent: running it twice deletes nothing the second time.

DO $$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['events', 'sessions', 'visitors'] LOOP
    IF to_regclass('public.' || target) IS NOT NULL THEN
      EXECUTE format('DELETE FROM %I WHERE site <> %L', target, 'jaytibirthday.in');
    END IF;
  END LOOP;
END $$;
