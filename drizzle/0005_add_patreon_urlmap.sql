-- Add Patreon platform to urlmap table
INSERT INTO urlmap (
    site_url,
    site_name,
    example,
    app_string_format,
    "order",
    is_iframe_enabled,
    is_embed_enabled,
    card_description,
    card_platform_name,
    is_web3_site,
    site_image,
    regex,
    regex_matcher,
    is_monetized,
    regex_options,
    platform_type_list,
    color_hex
) VALUES (
    'https://www.patreon.com',                         -- site_url
    'patreon',                                          -- site_name (column in artists table)
    'www.patreon.com/ARTIST',                           -- example shown in “Tips” dropdown
    'https://www.patreon.com/%@',                       -- app_string_format ("%@" replaced with username)
    60,                                                 -- order (after other social links)
    false,                                              -- is_iframe_enabled
    false,                                              -- is_embed_enabled
    'Support on Patreon',                               -- card_description
    'Patreon',                                          -- card_platform_name (display text)
    false,                                              -- is_web3_site
    '/siteIcons/patreon.svg',                           -- site_image (icon path in /public)
    '^https?:\\/\\/(?:www\\.)?patreon\\.com\\/([A-Za-z0-9_-]+)(?:\\/)?$', -- regex (double-escaped for SQL)
    NULL,                                               -- regex_matcher (not used)
    true,                                               -- is_monetized (Patreon is a support link)
    '{}',                                               -- regex_options – empty array
    '{social}',                                         -- platform_type_list – one value from enum
    '#F96854'                                           -- color_hex (Patreon brand colour)
) ON CONFLICT (site_name) DO NOTHING; 