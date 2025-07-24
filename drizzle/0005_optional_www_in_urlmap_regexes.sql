-- Make "www." optional in urlmap.regex patterns that currently only allow the protocol prefix
-- This brings them in line with existing handling of optional "https://".

BEGIN;

UPDATE urlmap
SET    regex = regexp_replace(
               regex,
               '^https?:\\/\\/',              -- match the leading protocol
               '^https?:\\/\\/(?:www\\.)?',   -- add optional www.
               1                                -- replace first occurrence only
       )
WHERE  regex NOT LIKE '%www\\.%';

COMMIT; 