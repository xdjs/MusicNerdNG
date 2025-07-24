-- ========================================
-- YouTube URL Refactor Data Migration Script
-- ========================================
-- 
-- Based on production data analysis of 17,127 YouTube entries:
-- - Channel IDs (UC...): 16,852 → Keep in youtubechannel
-- - @ Usernames: 104 → Move to youtube 
-- - Plain Usernames: 75 → Move to youtube (add @)
-- - Invalid Fragments: 88 → Delete
-- - Other Channel IDs: 8 → Clean & Keep
--
-- CRITICAL: Run in transaction with rollback capability
-- ========================================

BEGIN;

-- Step 1: Create backup table for rollback capability
DROP TABLE IF EXISTS artists_youtubechannel_backup;
CREATE TABLE artists_youtubechannel_backup AS 
SELECT id, name, youtubechannel, youtube, updatedAt 
FROM artists 
WHERE youtubechannel IS NOT NULL AND youtubechannel != '';

SELECT 'BACKUP CREATED: ' || COUNT(*) || ' records backed up' as status
FROM artists_youtubechannel_backup;

-- Step 2: Move @ usernames to youtube column (104 entries)
UPDATE artists 
SET 
    youtube = youtubechannel,
    youtubechannel = NULL,
    updatedAt = NOW()
WHERE youtubechannel LIKE '@%'
    AND youtube IS NULL; -- Don't overwrite existing youtube data

SELECT 'STEP 2 COMPLETED: Moved ' || ROW_COUNT() || ' @usernames to youtube column' as status;

-- Step 3: Move plain usernames to youtube column with @ prefix (75 entries)  
UPDATE artists 
SET 
    youtube = '@' || youtubechannel,
    youtubechannel = NULL,
    updatedAt = NOW()
WHERE youtubechannel IS NOT NULL 
    AND youtubechannel != ''
    AND youtubechannel NOT LIKE '@%'
    AND youtubechannel NOT LIKE 'UC%'
    AND youtubechannel NOT LIKE 'UU%'
    AND youtubechannel NOT LIKE 'UCS%'
    AND youtubechannel NOT LIKE 'C%'
    AND youtubechannel NOT IN ('playlist', 'featured', 'videos', 'about', 'community', 'shorts', 'streams', 'search')
    AND LENGTH(youtubechannel) <= 20
    AND youtube IS NULL; -- Don't overwrite existing youtube data

SELECT 'STEP 3 COMPLETED: Moved ' || ROW_COUNT() || ' plain usernames to youtube column with @ prefix' as status;

-- Step 4: Clean up channel IDs with data quality issues (8 entries)
-- Fix leading/trailing spaces
UPDATE artists 
SET 
    youtubechannel = TRIM(youtubechannel),
    updatedAt = NOW()
WHERE youtubechannel IS NOT NULL 
    AND youtubechannel != TRIM(youtubechannel);

-- Fix lowercase UC channel IDs (specifically: ucdapubnszix2-_wx0kp-4uq)
UPDATE artists 
SET 
    youtubechannel = UPPER(SUBSTRING(youtubechannel, 1, 2)) || SUBSTRING(youtubechannel, 3),
    updatedAt = NOW()
WHERE youtubechannel IS NOT NULL 
    AND LOWER(youtubechannel) LIKE 'uc%'
    AND youtubechannel != UPPER(SUBSTRING(youtubechannel, 1, 2)) || SUBSTRING(youtubechannel, 3);

SELECT 'STEP 4 COMPLETED: Cleaned ' || ROW_COUNT() || ' channel IDs with data quality issues' as status;

-- Step 5: Delete invalid URL fragments (88 entries)
UPDATE artists 
SET 
    youtubechannel = NULL,
    updatedAt = NOW()
WHERE youtubechannel IN ('playlist', 'featured', 'videos', 'about', 'community', 'shorts', 'streams', 'search');

SELECT 'STEP 5 COMPLETED: Removed ' || ROW_COUNT() || ' invalid URL fragments' as status;

-- Step 6: Verification queries
SELECT 'VERIFICATION - Post-migration data summary:' as status;

SELECT 
    'youtube column (usernames)' as column_type,
    COUNT(*) as total_entries,
    COUNT(DISTINCT youtube) as unique_values
FROM artists 
WHERE youtube IS NOT NULL AND youtube != ''

UNION ALL

SELECT 
    'youtubechannel column (channel IDs)' as column_type, 
    COUNT(*) as total_entries,
    COUNT(DISTINCT youtubechannel) as unique_values
FROM artists 
WHERE youtubechannel IS NOT NULL AND youtubechannel != '';

-- Step 7: Validate migration results
SELECT 'VALIDATION CHECKS:' as status;

-- Check for any remaining invalid data
SELECT 
    'Invalid fragments remaining' as check_type,
    COUNT(*) as count
FROM artists 
WHERE youtubechannel IN ('playlist', 'featured', 'videos', 'about', 'community', 'shorts', 'streams', 'search')

UNION ALL

-- Check for usernames accidentally left in youtubechannel
SELECT 
    'Usernames still in youtubechannel' as check_type,
    COUNT(*) as count
FROM artists 
WHERE youtubechannel IS NOT NULL 
    AND youtubechannel NOT LIKE 'UC%'
    AND youtubechannel NOT LIKE 'UU%' 
    AND youtubechannel NOT LIKE 'UCS%'
    AND youtubechannel NOT LIKE 'C%'
    AND LENGTH(youtubechannel) <= 20

UNION ALL

-- Check for youtube entries without @ prefix
SELECT 
    'YouTube usernames without @ prefix' as check_type,
    COUNT(*) as count
FROM artists 
WHERE youtube IS NOT NULL 
    AND youtube != ''
    AND youtube NOT LIKE '@%';

-- ========================================
-- ROLLBACK SCRIPT (run if issues found)
-- ========================================
-- 
-- If validation fails, run this to restore original data:
-- 
-- UPDATE artists 
-- SET 
--     youtubechannel = backup.youtubechannel,
--     youtube = backup.youtube,
--     updatedAt = backup.updatedAt
-- FROM artists_youtubechannel_backup backup
-- WHERE artists.id = backup.id;
--
-- DROP TABLE artists_youtubechannel_backup;
-- ========================================

-- Commit the transaction (comment out if testing)
COMMIT;

SELECT 'MIGRATION COMPLETED SUCCESSFULLY! Check validation results above.' as final_status; 