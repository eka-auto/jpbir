-- The recovery inventory previously coerced WhatsApp address objects with
-- String(value), producing literal "[object Object]" senders. Missing authors
-- were likewise stored as "<Undefined>". Keep raw JSON as evidence, but clear
-- the unusable indexed/display value so the API can label it from direction
-- and chat metadata (You / contact name / Unknown participant / System).
UPDATE wa_messages
   SET sender = NULL
 WHERE sender IS NOT NULL
   AND (
     btrim(sender) = ''
     OR lower(btrim(sender)) IN (
       '[object object]', '<undefined>', 'undefined', '[undefined]',
       '<null>', 'null', '[null]'
     )
   );
