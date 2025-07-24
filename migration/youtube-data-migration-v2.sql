-- ========================================
-- YouTube URL Refactor Data Migration Script V2
-- ========================================
-- 
-- Based on PRODUCTION data analysis (much more complex than dev):
-- YouTube Column (5,514 entries):
--   - Plain Usernames: 5,322 → KEEP (already correct)
--   - Channel IDs (UC...): 153 → MOVE to youtubechannel  
--   - Possible Channel IDs: 29 → MOVE to youtubechannel
--   - Invalid Fragments: 9 → DELETE
--   - @ Usernames: 1 → KEEP (already correct)
--
-- YouTubeChannel Column (17,127 entries):
--   - Channel IDs (UC...): 16,851 → KEEP (already correct)
--   - @ Usernames: 105 → MOVE to youtube
--   - Plain Usernames: 75 → MOVE to youtube (add @)
--   - Invalid Fragments: 88 → DELETE  
--   - Other Channel IDs: 8 → CLEAN & KEEP
--
-- Overlapping Data (1,888 artists with BOTH columns):
--   - Plain username + Channel ID: 1,820 → IDEAL STATE (preserve)
--   - Channel ID duplicates: 58 → RESOLVE conflicts
--   - @ Username + Channel ID: 1 → IDEAL STATE (preserve)
--
-- CRITICAL: Bidirectional migration with conflict resolution
-- ========================================

BEGIN;

-- Step 0: Create comprehensive backup table
DROP TABLE IF EXISTS artists_youtube_migration_v2_backup;
CREATE TABLE artists_youtube_migration_v2_backup AS 
SELECT 
    id,
    name,
    youtube,
    youtubechannel,
    updated_at,
    created_at
FROM artists 
WHERE (youtube IS NOT NULL AND youtube != '') 
   OR (youtubechannel IS NOT NULL AND youtubechannel != '');

SELECT 'BACKUP CREATED: ' || COUNT(*) || ' records backed up' as status
FROM artists_youtube_migration_v2_backup;

-- Step 1: Handle YouTubeChannel → YouTube migrations (usernames going to correct column)
-- 1a: Move @ usernames from youtubechannel to youtube (105 entries)
UPDATE artists 
SET 
    youtube = CASE 
        WHEN youtube IS NULL OR youtube = '' THEN youtubechannel
        ELSE youtube -- Don't overwrite existing youtube data
    END,
    youtubechannel = CASE 
        WHEN youtube IS NULL OR youtube = '' THEN NULL
        ELSE youtubechannel -- Keep youtubechannel if youtube already has data
    END,
    updated_at = NOW()
WHERE youtubechannel LIKE '@%'
    AND youtubechannel IS NOT NULL;

SELECT 'STEP 1A COMPLETED: Processed @ usernames from youtubechannel' as status;

-- 1b: Move plain usernames from youtubechannel to youtube with @ prefix (75 entries)
UPDATE artists 
SET 
    youtube = CASE 
        WHEN youtube IS NULL OR youtube = '' THEN '@' || youtubechannel
        ELSE youtube -- Don't overwrite existing youtube data
    END,
    youtubechannel = CASE 
        WHEN youtube IS NULL OR youtube = '' THEN NULL
        ELSE youtubechannel -- Keep youtubechannel if youtube already has data
    END,
    updated_at = NOW()
WHERE youtubechannel IS NOT NULL 
    AND youtubechannel != ''
    AND youtubechannel NOT LIKE '@%'
    AND youtubechannel NOT LIKE 'UC%'
    AND youtubechannel NOT LIKE 'UU%'
    AND youtubechannel NOT LIKE 'UCS%'
    AND youtubechannel NOT LIKE 'C%'
    AND youtubechannel NOT IN ('playlist', 'featured', 'videos', 'about', 'community', 'shorts', 'streams', 'search')
    AND LENGTH(youtubechannel) <= 20;

SELECT 'STEP 1B COMPLETED: Processed plain usernames from youtubechannel' as status;

-- Step 2: Handle YouTube → YouTubeChannel migrations (channel IDs going to correct column)
-- 2a: Move UC channel IDs from youtube to youtubechannel (153 entries)
UPDATE artists 
SET 
    youtubechannel = CASE 
        WHEN youtubechannel IS NULL OR youtubechannel = '' THEN youtube
        WHEN youtubechannel = youtube THEN youtubechannel -- Keep if duplicate
        ELSE youtubechannel -- Don't overwrite different youtubechannel data
    END,
    youtube = CASE 
        WHEN youtubechannel IS NULL OR youtubechannel = '' THEN NULL
        WHEN youtubechannel = youtube THEN NULL -- Clear duplicate
        ELSE youtube -- Keep youtube if youtubechannel already has different data
    END,
    updated_at = NOW()
WHERE youtube LIKE 'UC%'
    AND youtube IS NOT NULL;

SELECT 'STEP 2A COMPLETED: Processed UC channel IDs from youtube' as status;

-- 2b: Move other possible channel IDs from youtube to youtubechannel (29 entries)
UPDATE artists 
SET 
    youtubechannel = CASE 
        WHEN youtubechannel IS NULL OR youtubechannel = '' THEN youtube
        WHEN youtubechannel = youtube THEN youtubechannel -- Keep if duplicate
        ELSE youtubechannel -- Don't overwrite different youtubechannel data
    END,
    youtube = CASE 
        WHEN youtubechannel IS NULL OR youtubechannel = '' THEN NULL
        WHEN youtubechannel = youtube THEN NULL -- Clear duplicate
        ELSE youtube -- Keep youtube if youtubechannel already has different data
    END,
    updated_at = NOW()
WHERE youtube IS NOT NULL 
    AND youtube != ''
    AND youtube NOT LIKE '@%'
    AND youtube NOT IN ('playlist', 'featured', 'videos', 'about', 'community', 'shorts', 'streams', 'search')
    AND LENGTH(youtube) > 20;

SELECT 'STEP 2B COMPLETED: Processed possible channel IDs from youtube' as status;

-- Step 3: Clean up channel IDs with data quality issues
-- 3a: Fix leading/trailing spaces in youtubechannel
UPDATE artists 
SET 
    youtubechannel = TRIM(youtubechannel),
    updated_at = NOW()
WHERE youtubechannel IS NOT NULL 
    AND youtubechannel != TRIM(youtubechannel);

-- 3b: Fix lowercase UC channel IDs in youtubechannel
UPDATE artists 
SET 
    youtubechannel = UPPER(SUBSTRING(youtubechannel, 1, 2)) || SUBSTRING(youtubechannel, 3),
    updated_at = NOW()
WHERE youtubechannel IS NOT NULL 
    AND LOWER(youtubechannel) LIKE 'uc%'
    AND youtubechannel != UPPER(SUBSTRING(youtubechannel, 1, 2)) || SUBSTRING(youtubechannel, 3);

SELECT 'STEP 3 COMPLETED: Cleaned channel ID data quality issues' as status;

-- Step 4: Delete invalid URL fragments
-- 4a: Remove invalid fragments from youtubechannel
UPDATE artists 
SET 
    youtubechannel = NULL,
    updated_at = NOW()
WHERE youtubechannel IN ('playlist', 'featured', 'videos', 'about', 'community', 'shorts', 'streams', 'search');

-- 4b: Remove invalid fragments from youtube
UPDATE artists 
SET 
    youtube = NULL,
    updated_at = NOW()
WHERE youtube IN ('playlist', 'featured', 'videos', 'about', 'community', 'shorts', 'streams', 'search');

SELECT 'STEP 4 COMPLETED: Removed invalid URL fragments from both columns' as status;

-- Step 5: Ensure @ prefix for all usernames in youtube column
UPDATE artists 
SET 
    youtube = '@' || youtube,
    updated_at = NOW()
WHERE youtube IS NOT NULL 
    AND youtube != ''
    AND youtube NOT LIKE '@%'
    AND youtube NOT LIKE 'UC%'
    AND LENGTH(youtube) <= 20;

SELECT 'STEP 5 COMPLETED: Added @ prefix to usernames in youtube column' as status;

-- Step 6: Post-migration data verification
SELECT 
    'POST-MIGRATION DATA SUMMARY:' as verification_type,
    NULL as column_type,
    NULL as total_entries,
    NULL as unique_values
    
UNION ALL

SELECT 
    'Data Verification' as verification_type,
    'youtube column (usernames)' as column_type,
    COUNT(*)::text as total_entries,
    COUNT(DISTINCT youtube)::text as unique_values
FROM artists 
WHERE youtube IS NOT NULL AND youtube != ''

UNION ALL

SELECT 
    'Data Verification' as verification_type,
    'youtubechannel column (channel IDs)' as column_type,
    COUNT(*)::text as total_entries,
    COUNT(DISTINCT youtubechannel)::text as unique_values
FROM artists 
WHERE youtubechannel IS NOT NULL AND youtubechannel != ''

UNION ALL

SELECT 
    'Data Verification' as verification_type,
    'artists with both columns (ideal)' as column_type,
    COUNT(*)::text as total_entries,
    'N/A' as unique_values
FROM artists 
WHERE youtube IS NOT NULL AND youtube != '' 
    AND youtubechannel IS NOT NULL AND youtubechannel != '';

-- Step 7: Validation checks
SELECT 'VALIDATION CHECKS:' as validation_type;

-- Check 1: Invalid fragments remaining (should be 0)
SELECT 
    'Invalid fragments in youtubechannel' as check_type,
    COUNT(*) as count
FROM artists 
WHERE youtubechannel IN ('playlist', 'featured', 'videos', 'about', 'community', 'shorts', 'streams', 'search')

UNION ALL

SELECT 
    'Invalid fragments in youtube' as check_type,
    COUNT(*) as count
FROM artists 
WHERE youtube IN ('playlist', 'featured', 'videos', 'about', 'community', 'shorts', 'streams', 'search')

UNION ALL

-- Check 2: Channel IDs accidentally in youtube column (should be 0)
SELECT 
    'Channel IDs still in youtube column' as check_type,
    COUNT(*) as count
FROM artists 
WHERE youtube IS NOT NULL 
    AND (youtube LIKE 'UC%' OR LENGTH(youtube) > 20)

UNION ALL

-- Check 3: Usernames accidentally in youtubechannel column (should be 0)
SELECT 
    'Usernames still in youtubechannel' as check_type,
    COUNT(*) as count
FROM artists 
WHERE youtubechannel IS NOT NULL 
    AND youtubechannel LIKE '@%'

UNION ALL

-- Check 4: YouTube usernames without @ prefix (should be 0)
SELECT 
    'YouTube usernames without @ prefix' as check_type,
    COUNT(*) as count
FROM artists 
WHERE youtube IS NOT NULL 
    AND youtube != ''
    AND youtube NOT LIKE '@%'
    AND youtube NOT LIKE 'UC%'
    AND LENGTH(youtube) <= 20

UNION ALL

-- Check 5: Total YouTube data preserved
SELECT 
    'Total YouTube entries after migration' as check_type,
    (SELECT COUNT(*) FROM artists WHERE youtube IS NOT NULL AND youtube != '') +
    (SELECT COUNT(*) FROM artists WHERE youtubechannel IS NOT NULL AND youtubechannel != '') as count;

-- ========================================
-- ENHANCED ROLLBACK SCRIPT (run if issues found)
-- ========================================
-- 
-- If validation fails, run this to restore original data:
-- 
-- UPDATE artists 
-- SET 
--     youtube = backup.youtube,
--     youtubechannel = backup.youtubechannel,
--     updated_at = backup.updated_at
-- FROM artists_youtube_migration_v2_backup backup
-- WHERE artists.id = backup.id;
--
-- DROP TABLE artists_youtube_migration_v2_backup;
-- ========================================

-- Commit the transaction (comment out if testing)
COMMIT;

SELECT 'MIGRATION V2 COMPLETED SUCCESSFULLY! Check validation results above.' as final_status; 