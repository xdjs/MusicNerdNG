-- Ensure Patreon urlmap entry has correct regex pattern and example
-- If the row is missing, insert it; otherwise update the existing row

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
    'https://www.patreon.com',
    'patreon',
    'www.patreon.com/ARTIST',
    'https://www.patreon.com/%@',
    60,
    false,
    false,
    'Support on Patreon',
    'Patreon',
    false,
    '/siteIcons/patreon.svg',
    '^https?:\\/\\/(?:www\\.)?patreon\\.com\\/([A-Za-z0-9_-]+)(?:\\/)?$',
    NULL,
    true,
    '{}',
    '{social}',
    '#F96854'
) ON CONFLICT (site_name) DO UPDATE SET
    regex = EXCLUDED.regex,
    example = EXCLUDED.example; 