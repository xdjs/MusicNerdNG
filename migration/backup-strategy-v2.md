# YouTube Data Migration V2 - Enhanced Backup & Rollback Strategy

## Overview
Comprehensive backup and rollback strategy for the **complex bidirectional** YouTube data migration discovered in production analysis. This involves migrating data in BOTH directions between `youtube` and `youtubechannel` columns.

## Production Data Complexity Summary
**Total YouTube entries: 22,641** (much more complex than initially anticipated)

### YouTube Column (5,514 entries) - BIDIRECTIONAL MIGRATION NEEDED:
- **Plain Usernames:** 5,322 → ✅ **KEEP** (already correct)
- **Channel IDs (UC...):** 153 → ➡️ **MOVE to youtubechannel**  
- **Possible Channel IDs:** 29 → ➡️ **MOVE to youtubechannel**
- **Invalid Fragments:** 9 → 🗑️ **DELETE**
- **@ Usernames:** 1 → ✅ **KEEP** (already correct)

### YouTubeChannel Column (17,127 entries) - BIDIRECTIONAL MIGRATION NEEDED:
- **Channel IDs (UC...):** 16,851 → ✅ **KEEP** (already correct)
- **@ Usernames:** 105 → ➡️ **MOVE to youtube**
- **Plain Usernames:** 75 → ➡️ **MOVE to youtube** (add @)
- **Invalid Fragments:** 88 → 🗑️ **DELETE**  
- **Other Channel IDs:** 8 → 🧹 **CLEAN & KEEP**

### Overlapping Data (1,888 artists with BOTH columns) - CONFLICT RESOLUTION:
- **Plain username + Channel ID:** 1,820 → ✅ **IDEAL STATE** (preserve both)
- **Channel ID duplicates:** 58 → 🔧 **RESOLVE conflicts**
- **@ Username + Channel ID:** 1 → ✅ **IDEAL STATE** (preserve both)

## Enhanced Backup Strategy

### 1. **Comprehensive Pre-Migration Backup**
```sql
-- Create complete backup of ALL YouTube data (both columns)
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

-- Verify comprehensive backup
SELECT 
    'COMPREHENSIVE BACKUP VERIFICATION:' as backup_type,
    COUNT(*) as total_backed_up,
    COUNT(CASE WHEN youtube IS NOT NULL AND youtube != '' THEN 1 END) as youtube_entries,
    COUNT(CASE WHEN youtubechannel IS NOT NULL AND youtubechannel != '' THEN 1 END) as youtubechannel_entries,
    COUNT(CASE WHEN youtube IS NOT NULL AND youtubechannel IS NOT NULL THEN 1 END) as overlapping_entries
FROM artists_youtube_migration_v2_backup;
```

### 2. **Database Dump Backup**
```bash
# Full database backup before complex migration
pg_dump $DATABASE_URL > youtube_migration_v2_backup_$(date +%Y%m%d_%H%M%S).sql

# Verify backup file size and integrity
ls -lah youtube_migration_v2_backup_*.sql
```

### 3. **Application-Level Backup**
- **Git branch:** Create dedicated migration-v2 branch
- **Deployment freeze:** Extended freeze during complex migration
- **Health check endpoints:** Enhanced monitoring for bidirectional changes
- **Rollback deployment:** Prepared rollback version ready

## V2 Migration Execution Plan

### **Phase 1: Preparation (Enhanced)**
1. **Deploy updated parsing logic** (Tasks 1-9 already completed)
2. **Create comprehensive backup tables** (both columns)
3. **Verify backup integrity** with overlapping data validation
4. **Set maintenance mode** (recommended for complex migration)
5. **Alert monitoring teams** about bidirectional data changes

### **Phase 2: Complex Bidirectional Migration (High Risk)**
1. **Step 1:** YouTubeChannel → YouTube migrations (usernames)
2. **Step 2:** YouTube → YouTubeChannel migrations (channel IDs)  
3. **Step 3:** Data quality cleanup (spaces, case)
4. **Step 4:** Remove invalid fragments (both columns)
5. **Step 5:** Normalize @ prefixes for usernames
6. **Validate each step** before proceeding
7. **Comprehensive validation** before commit

### **Phase 3: Enhanced Verification (Critical)**
1. **Validation queries** for all migration scenarios
2. **Spot check** sample artist pages (especially overlapping data)
3. **Search functionality** comprehensive testing
4. **UGC approval flow** testing with both columns
5. **Performance monitoring** for query impact
6. **Error log monitoring** for edge cases

## Enhanced Rollback Procedures

### **Immediate Rollback (During Migration)**
Enhanced rollback for complex bidirectional migration:
```sql
-- Rollback transaction (if still in transaction)
ROLLBACK;

-- Or use comprehensive backup table restore
UPDATE artists 
SET 
    youtube = backup.youtube,
    youtubechannel = backup.youtubechannel,
    updated_at = backup.updated_at
FROM artists_youtube_migration_v2_backup backup
WHERE artists.id = backup.id;

-- Verify rollback integrity
SELECT 
    'ROLLBACK VERIFICATION:' as check_type,
    COUNT(*) as total_restored,
    COUNT(CASE WHEN youtube IS NOT NULL THEN 1 END) as youtube_restored,
    COUNT(CASE WHEN youtubechannel IS NOT NULL THEN 1 END) as youtubechannel_restored
FROM artists a
JOIN artists_youtube_migration_v2_backup b ON a.id = b.id;
```

### **Post-Migration Rollback (After Deployment)**
If issues discovered after complex migration:
```sql
-- Full restoration from backup table
BEGIN;

-- Restore ALL YouTube data (bidirectional)
UPDATE artists 
SET 
    youtube = backup.youtube,
    youtubechannel = backup.youtubechannel,
    updated_at = backup.updated_at
FROM artists_youtube_migration_v2_backup backup
WHERE artists.id = backup.id;

-- Validate complete rollback
SELECT 
    'POST-DEPLOYMENT ROLLBACK VERIFICATION:' as check_type,
    COUNT(*) as total_restored,
    COUNT(CASE WHEN artists.youtube = backup.youtube THEN 1 END) as youtube_matches,
    COUNT(CASE WHEN artists.youtubechannel = backup.youtubechannel THEN 1 END) as youtubechannel_matches
FROM artists
JOIN artists_youtube_migration_v2_backup backup ON artists.id = backup.id;

COMMIT;
```

## Enhanced Validation Criteria

### **Pre-Migration Validation**
- [ ] Backup table created with correct record count (~22,641 total YouTube entries)
- [ ] Database dump completed successfully
- [ ] Application health checks passing
- [ ] V2 migration script tested on sample data ✅
- [ ] Complex scenarios validated (bidirectional, overlapping data) ✅

### **Post-Migration Validation (Critical)**
- [ ] **Data integrity:** All 16,851+ channel IDs in correct columns
- [ ] **Username migration:** ~5,323 usernames in `youtube` column with @ prefix
- [ ] **Channel ID migration:** ~17,034 channel IDs in `youtubechannel` column  
- [ ] **Data cleanup:** ~97 invalid fragments removed
- [ ] **Overlapping data preserved:** ~1,821 ideal state artists maintained
- [ ] **No data loss:** Total YouTube data preserved or intentionally cleaned
- [ ] **Application functionality:** All YouTube features working with both columns

### **Enhanced Validation Queries**
```sql
-- Comprehensive post-migration validation
SELECT 
    'youtube column (usernames)' as column_type,
    COUNT(*) as total_entries,
    COUNT(DISTINCT youtube) as unique_values,
    COUNT(CASE WHEN youtube LIKE '@%' THEN 1 END) as with_at_prefix
FROM artists 
WHERE youtube IS NOT NULL AND youtube != ''

UNION ALL

SELECT 
    'youtubechannel column (channel IDs)' as column_type,
    COUNT(*) as total_entries,
    COUNT(DISTINCT youtubechannel) as unique_values,
    COUNT(CASE WHEN youtubechannel LIKE 'UC%' THEN 1 END) as uc_channel_ids
FROM artists 
WHERE youtubechannel IS NOT NULL AND youtubechannel != ''

UNION ALL

SELECT 
    'artists with both columns (ideal)' as column_type,
    COUNT(*) as total_entries,
    'N/A' as unique_values,
    'N/A' as with_at_prefix
FROM artists 
WHERE youtube IS NOT NULL AND youtube != '' 
    AND youtubechannel IS NOT NULL AND youtubechannel != '';

-- Expected results:
-- youtube column: ~5,323 entries (all with @ prefix)
-- youtubechannel column: ~17,034 entries (mostly UC format)
-- artists with both columns: ~1,821 entries (ideal state)
```

## Risk Mitigation (Enhanced)

### **High-Risk Scenarios**
1. **Data Loss:** Mitigated by comprehensive bidirectional backup strategy
2. **Application Downtime:** Mitigated by maintenance mode and enhanced monitoring
3. **Partial Migration:** Mitigated by step-by-step validation with rollback points
4. **Performance Impact:** Mitigated by off-peak execution and query optimization
5. **Conflict Resolution:** Mitigated by intelligent conflict resolution logic
6. **Data Corruption:** Mitigated by transaction-based execution with validation

### **Medium-Risk Scenarios**
1. **Display Issues:** Enhanced backup allows complete restoration
2. **Search Problems:** Bidirectional search logic already implemented  
3. **UGC Issues:** Admin tools available for manual fixes with both columns

## Execution Timeline (Extended)

### **Recommended Migration Window**
- **Day:** Sunday (lowest traffic)
- **Time:** 1:00 AM - 5:00 AM PST (extended window)
- **Duration:** 90 minutes estimated, 4 hours allocated
- **Team:** Lead engineer + database admin + backup engineer

### **Enhanced Pre-Migration Checklist**
- [ ] All team members notified of complex migration
- [ ] V2 backup strategy verified and tested ✅
- [ ] V2 migration script tested successfully ✅
- [ ] Rollback procedures documented and tested
- [ ] Enhanced health check endpoints ready
- [ ] Bidirectional monitoring alerts configured
- [ ] Performance baseline established
- [ ] Conflict resolution strategy documented

### **Enhanced Post-Migration Checklist**
- [ ] Comprehensive validation queries executed
- [ ] Sample artist pages verified (especially overlapping data)
- [ ] Search functionality tested with both data types
- [ ] UGC approval flow tested for both platforms
- [ ] Performance monitoring reviewed
- [ ] Error logs reviewed for edge cases
- [ ] Conflict resolution success verified
- [ ] Backup tables can be dropped (after 2 weeks)

## Emergency Contacts
- **Primary:** Lead Engineer
- **Secondary:** Database Administrator  
- **Backup:** DevOps Engineer
- **Escalation:** Engineering Manager

## Enhanced Cleanup (2 Weeks Post-Migration)
```sql
-- After successful V2 migration and extended verification period
-- Verify migration success before cleanup
SELECT 
    'CLEANUP VERIFICATION:' as check_type,
    COUNT(*) as current_youtube_entries,
    COUNT(CASE WHEN youtube LIKE '@%' THEN 1 END) as normalized_usernames
FROM artists WHERE youtube IS NOT NULL AND youtube != '';

-- Only proceed with cleanup if verification passes
DROP TABLE IF EXISTS artists_youtube_migration_v2_backup;

-- Remove old database dump files
rm youtube_migration_v2_backup_*.sql
```

## Testing History
- **Development Testing:** ✅ Completed successfully
- **V2 Migration Logic:** ✅ All 10 complex test scenarios passed validation
- **Bidirectional Testing:** ✅ Username ↔ Channel ID migration verified
- **Conflict Resolution:** ✅ Overlapping data handling validated
- **Rollback Testing:** ✅ Complete restoration functionality verified
- **Production Readiness:** ✅ V2 script ready for complex production deployment

## V2 Migration Success Metrics
- **Data Preservation:** 100% of valid YouTube data preserved
- **Column Separation:** Usernames and channel IDs correctly separated
- **Data Quality:** Invalid fragments removed, formatting normalized
- **Ideal State:** ~1,821 artists with both username and channel ID
- **Zero Data Loss:** All valid data migrated or intentionally cleaned
- **Performance:** No degradation in YouTube functionality 