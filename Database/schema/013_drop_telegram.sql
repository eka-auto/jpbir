-- Retires the Telegram tables and the parallel backend that read them.
--
-- 010_telegram.sql created tg_chats / tg_messages / tg_sync_runs for a
-- Telegram panel that was meant to show data captured from the phone. No
-- Telegram capture ever landed, so those tables have held zero rows since
-- they were created, and the route that read them (Backend/jp-telegram.js)
-- was a second copy of the WhatsApp read path pointed at an empty dataset.
--
-- The Telegram panel is now a second slot for the WhatsApp client: the same
-- component, the same endpoints, the same live data. There is no separate
-- Telegram dataset to read, so there is nothing for these tables to hold.
--
-- They are dropped rather than left behind because an empty table with a
-- live-looking name is a claim the database cannot back up. If a real
-- Telegram capture is ever wanted, it gets its own schema file with a new
-- number, the way every other table in this database did.
--
-- IF EXISTS throughout: this file must be safe to apply to a database that
-- never ran 010_telegram.sql (a fresh clone, or a branch that predates it).

DROP TABLE IF EXISTS tg_messages;
DROP TABLE IF EXISTS tg_chats;
DROP TABLE IF EXISTS tg_sync_runs;
