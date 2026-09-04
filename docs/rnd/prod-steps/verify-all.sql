-- End-state verification for migrations 0011-0021.
-- Built by replaying CREATE/DROP INDEX in statement order, so an index that
-- is dropped and recreated (0020) is expected PRESENT, while 0017's indexes
-- that 0019 replaces are expected ABSENT.
SELECT * FROM (
  SELECT 'table'  AS kind, 'artist_doc_corrections' AS name, to_regclass('public.artist_doc_corrections') IS NOT NULL AS ok
  UNION ALL
  SELECT 'table'  AS kind, 'artist_docs' AS name, to_regclass('public.artist_docs') IS NOT NULL AS ok
  UNION ALL
  SELECT 'table'  AS kind, 'artist_interview_answers' AS name, to_regclass('public.artist_interview_answers') IS NOT NULL AS ok
  UNION ALL
  SELECT 'table'  AS kind, 'artist_onboarding_steps' AS name, to_regclass('public.artist_onboarding_steps') IS NOT NULL AS ok
  UNION ALL
  SELECT 'table'  AS kind, 'artist_research_jobs' AS name, to_regclass('public.artist_research_jobs') IS NOT NULL AS ok
  UNION ALL
  SELECT 'table'  AS kind, 'artist_social_credits' AS name, to_regclass('public.artist_social_credits') IS NOT NULL AS ok
  UNION ALL
  SELECT 'table'  AS kind, 'artist_social_posts' AS name, to_regclass('public.artist_social_posts') IS NOT NULL AS ok
  UNION ALL
  SELECT 'table'  AS kind, 'artist_social_profiles' AS name, to_regclass('public.artist_social_profiles') IS NOT NULL AS ok
  UNION ALL
  SELECT 'index',  'artist_doc_corrections_artist_claim_uniq', to_regclass('public.artist_doc_corrections_artist_claim_uniq') IS NOT NULL
  UNION ALL
  SELECT 'index',  'artist_research_jobs_claimable', to_regclass('public.artist_research_jobs_claimable') IS NOT NULL
  UNION ALL
  SELECT 'index',  'artist_research_jobs_one_live', to_regclass('public.artist_research_jobs_one_live') IS NOT NULL
  UNION ALL
  SELECT 'index',  'artist_social_credits_uniq', to_regclass('public.artist_social_credits_uniq') IS NOT NULL
  UNION ALL
  SELECT 'index',  'artist_vault_sources_artist_url_uniq', to_regclass('public.artist_vault_sources_artist_url_uniq') IS NOT NULL
  UNION ALL
  SELECT 'index',  'artists_handle_bandcamp_idx', to_regclass('public.artists_handle_bandcamp_idx') IS NOT NULL
  UNION ALL
  SELECT 'index',  'artists_handle_deezer_idx', to_regclass('public.artists_handle_deezer_idx') IS NOT NULL
  UNION ALL
  SELECT 'index',  'artists_handle_facebook_idx', to_regclass('public.artists_handle_facebook_idx') IS NOT NULL
  UNION ALL
  SELECT 'index',  'artists_handle_instagram_idx', to_regclass('public.artists_handle_instagram_idx') IS NOT NULL
  UNION ALL
  SELECT 'index',  'artists_handle_soundcloud_idx', to_regclass('public.artists_handle_soundcloud_idx') IS NOT NULL
  UNION ALL
  SELECT 'index',  'artists_handle_spotify_idx', to_regclass('public.artists_handle_spotify_idx') IS NOT NULL
  UNION ALL
  SELECT 'index',  'artists_handle_tiktok_idx', to_regclass('public.artists_handle_tiktok_idx') IS NOT NULL
  UNION ALL
  SELECT 'index',  'artists_handle_twitch_idx', to_regclass('public.artists_handle_twitch_idx') IS NOT NULL
  UNION ALL
  SELECT 'index',  'artists_handle_x_idx', to_regclass('public.artists_handle_x_idx') IS NOT NULL
  UNION ALL
  SELECT 'index',  'artists_handle_youtube_idx', to_regclass('public.artists_handle_youtube_idx') IS NOT NULL
  UNION ALL
  SELECT 'index',  'artists_handle_youtubechannel_idx', to_regclass('public.artists_handle_youtubechannel_idx') IS NOT NULL
  UNION ALL
  SELECT 'index',  'idx_artist_doc_corrections_artist_id', to_regclass('public.idx_artist_doc_corrections_artist_id') IS NOT NULL
  UNION ALL
  SELECT 'index',  'idx_artist_interview_answers_artist_id', to_regclass('public.idx_artist_interview_answers_artist_id') IS NOT NULL
  UNION ALL
  SELECT 'index',  'idx_artist_onboarding_steps_artist_id', to_regclass('public.idx_artist_onboarding_steps_artist_id') IS NOT NULL
  UNION ALL
  SELECT 'index',  'idx_artist_social_credits_artist', to_regclass('public.idx_artist_social_credits_artist') IS NOT NULL
  UNION ALL
  SELECT 'index',  'idx_artist_social_posts_artist_id', to_regclass('public.idx_artist_social_posts_artist_id') IS NOT NULL
  UNION ALL
  SELECT 'index',  'idx_artist_social_posts_own', to_regclass('public.idx_artist_social_posts_own') IS NOT NULL
  UNION ALL
  SELECT 'index',  'idx_artist_social_profiles_artist_id', to_regclass('public.idx_artist_social_profiles_artist_id') IS NOT NULL
  UNION ALL
  SELECT 'column', 'artist_docs.sources', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='artist_docs' AND column_name='sources')
  UNION ALL
  SELECT 'column', 'artist_vault_sources.published_at', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='artist_vault_sources' AND column_name='published_at')
  UNION ALL
  SELECT 'grant',  'artist_doc_corrections -> mnweb', has_table_privilege('mnweb','artist_doc_corrections','SELECT,INSERT,UPDATE,DELETE')
  UNION ALL
  SELECT 'grant',  'artist_docs -> mnweb', has_table_privilege('mnweb','artist_docs','SELECT,INSERT,UPDATE,DELETE')
  UNION ALL
  SELECT 'grant',  'artist_interview_answers -> mnweb', has_table_privilege('mnweb','artist_interview_answers','SELECT,INSERT,UPDATE,DELETE')
  UNION ALL
  SELECT 'grant',  'artist_onboarding_steps -> mnweb', has_table_privilege('mnweb','artist_onboarding_steps','SELECT,INSERT,UPDATE,DELETE')
  UNION ALL
  SELECT 'grant',  'artist_research_jobs -> mnweb', has_table_privilege('mnweb','artist_research_jobs','SELECT,INSERT,UPDATE,DELETE')
  UNION ALL
  SELECT 'grant',  'artist_social_credits -> mnweb', has_table_privilege('mnweb','artist_social_credits','SELECT,INSERT,UPDATE,DELETE')
  UNION ALL
  SELECT 'grant',  'artist_social_posts -> mnweb', has_table_privilege('mnweb','artist_social_posts','SELECT,INSERT,UPDATE,DELETE')
  UNION ALL
  SELECT 'grant',  'artist_social_profiles -> mnweb', has_table_privilege('mnweb','artist_social_profiles','SELECT,INSERT,UPDATE,DELETE')
  UNION ALL
  SELECT 'dropped','artists_lower_bandcamp_idx (must be absent)', to_regclass('public.artists_lower_bandcamp_idx') IS NULL
  UNION ALL
  SELECT 'dropped','artists_lower_deezer_idx (must be absent)', to_regclass('public.artists_lower_deezer_idx') IS NULL
  UNION ALL
  SELECT 'dropped','artists_lower_facebook_idx (must be absent)', to_regclass('public.artists_lower_facebook_idx') IS NULL
  UNION ALL
  SELECT 'dropped','artists_lower_instagram_idx (must be absent)', to_regclass('public.artists_lower_instagram_idx') IS NULL
  UNION ALL
  SELECT 'dropped','artists_lower_soundcloud_idx (must be absent)', to_regclass('public.artists_lower_soundcloud_idx') IS NULL
  UNION ALL
  SELECT 'dropped','artists_lower_spotify_idx (must be absent)', to_regclass('public.artists_lower_spotify_idx') IS NULL
  UNION ALL
  SELECT 'dropped','artists_lower_tiktok_idx (must be absent)', to_regclass('public.artists_lower_tiktok_idx') IS NULL
  UNION ALL
  SELECT 'dropped','artists_lower_twitch_idx (must be absent)', to_regclass('public.artists_lower_twitch_idx') IS NULL
  UNION ALL
  SELECT 'dropped','artists_lower_x_idx (must be absent)', to_regclass('public.artists_lower_x_idx') IS NULL
  UNION ALL
  SELECT 'dropped','artists_lower_youtube_idx (must be absent)', to_regclass('public.artists_lower_youtube_idx') IS NULL
  UNION ALL
  SELECT 'dropped','artists_lower_youtubechannel_idx (must be absent)', to_regclass('public.artists_lower_youtubechannel_idx') IS NULL
) v ORDER BY ok, kind, name;
