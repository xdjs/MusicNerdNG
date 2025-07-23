-- Broaden Patreon regex to accept trailing paths or query params

UPDATE urlmap
SET regex = '^https?:\\/\\/(?:www\\.)?patreon\\.com\\/([A-Za-z0-9_-]+)(?:[\\/\\?].*)?$'
WHERE site_name = 'patreon'; 