# YouTube Data Migration - Backup & Rollback Strategy

## Overview
Comprehensive backup and rollback strategy for migrating YouTube data from `youtubechannel` to `youtube` columns based on production data analysis of 17,127 entries.

## Production Data Summary
- **Total YouTube entries:** 17,127
- **Channel IDs (UC...):** 16,852 → Keep in `youtubechannel`
- **@ Usernames:** 104 → Move to `youtube`
- **Plain Usernames:** 75 → Move to `youtube` (add @)
- **Invalid Fragments:** 88 → Delete
- **Other Channel IDs:** 8 → Clean & Keep

## Backup Strategy

### 1. **Pre-Migration Backup**
```sql
-- Create complete backup of all YouTube data
CREATE TABLE artists_youtube_migration_backup AS 
SELECT 
    id,
    name,
    youtubechannel,
    youtube,
    updated_at,
    created_at
FROM artists 
WHERE youtubechannel IS NOT NULL AND youtubechannel != '';

-- Verify backup
SELECT 'BACKUP VERIFICATION: ' || COUNT(*) || ' records backed up' 
FROM artists_youtube_migration_backup;
```

### 2. **Database Dump Backup**
```bash
# Full database backup before migration
pg_dump $DATABASE_URL > youtube_migration_backup_$(date +%Y%m%d_%H%M%S).sql

# Verify backup file size and integrity
ls -lah youtube_migration_backup_*.sql
```

### 3. **Application-Level Backup**
- **Git branch:** Create dedicated migration branch
- **Deployment freeze:** No other deployments during migration window
- **Health check endpoints:** Verify before and after migration

## Migration Execution Plan

### **Phase 1: Preparation (Low Risk)**
1. **Deploy updated parsing logic** (Tasks 1-9 already completed)
2. **Create backup tables**
3. **Verify backup integrity**
4. **Set maintenance mode** (optional)

### **Phase 2: Data Migration (High Risk)**
1. **Run migration script** in transaction
2. **Validate results** against expected counts
3. **Commit transaction** only if validation passes
4. **Health check** all YouTube functionality

### **Phase 3: Verification (Medium Risk)**
1. **Spot check** sample artist pages
2. **Verify search functionality**
3. **Test UGC approval flow**
4. **Monitor error logs**

## Rollback Procedures

### **Immediate Rollback (During Migration)**
If validation fails during migration:
```sql
-- Rollback transaction (if still in transaction)
ROLLBACK;

-- Or use backup table restore
UPDATE artists 
SET 
    youtubechannel = backup.youtubechannel,
    youtube = backup.youtube,
    updated_at = backup.updated_at
FROM artists_youtube_migration_backup backup
WHERE artists.id = backup.id;
```

### **Post-Migration Rollback (After Deployment)**
If issues discovered after migration:
```sql
-- Full restoration from backup table
BEGIN;

-- Restore original data for all migrated records
UPDATE artists 
SET 
    youtubechannel = backup.youtubechannel,
    youtube = backup.youtube,
    updated_at = backup.updated_at
FROM artists_youtube_migration_backup backup
WHERE artists.id = backup.id;

-- Validate rollback
SELECT 'ROLLBACK VERIFICATION: ' || COUNT(*) || ' records restored'
FROM artists_youtube_migration_backup;

COMMIT;
```

### **Database-Level Rollback (Nuclear Option)**
If application-level rollback fails:
```bash
# Restore from full database dump
psql $DATABASE_URL < youtube_migration_backup_YYYYMMDD_HHMMSS.sql
```

## Validation Criteria

### **Pre-Migration Validation**
- [ ] Backup table created with correct record count (17,127)
- [ ] Database dump completed successfully
- [ ] Application health checks passing
- [ ] Migration script tested on sample data

### **Post-Migration Validation**
- [ ] **Data integrity:** All 16,852 channel IDs remain in `youtubechannel`
- [ ] **Username migration:** 179 usernames moved to `youtube` column with @ prefix
- [ ] **Data cleanup:** 88 invalid fragments removed
- [ ] **No data loss:** Total YouTube data preserved or intentionally cleaned
- [ ] **Application functionality:** All YouTube features working

### **Validation Queries**
```sql
-- Post-migration validation queries
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

-- Expected results:
-- youtube column: ~179 entries (104 + 75)
-- youtubechannel column: ~16,860 entries (16,852 + 8 cleaned)
```

## Risk Mitigation

### **High-Risk Scenarios**
1. **Data Loss:** Mitigated by comprehensive backup strategy
2. **Application Downtime:** Mitigated by maintenance mode and health checks
3. **Partial Migration:** Mitigated by transaction-based migration
4. **Performance Impact:** Mitigated by off-peak execution

### **Low-Risk Scenarios**
1. **Display Issues:** Can be fixed with code deployment
2. **Search Problems:** Existing functionality preserved
3. **UGC Issues:** Admin tools available for manual fixes

## Execution Timeline

### **Recommended Migration Window**
- **Day:** Sunday (lowest traffic)
- **Time:** 2:00 AM - 4:00 AM PST
- **Duration:** 30 minutes estimated, 2 hours allocated
- **Team:** On-call engineer + backup

### **Pre-Migration Checklist**
- [ ] All team members notified
- [ ] Backup strategy verified
- [ ] Migration script tested
- [ ] Rollback procedures documented
- [ ] Health check endpoints ready
- [ ] Monitoring alerts configured

### **Post-Migration Checklist**
- [ ] Validation queries executed
- [ ] Sample artist pages verified
- [ ] Search functionality tested
- [ ] UGC approval flow tested
- [ ] Error logs reviewed
- [ ] Backup tables can be dropped (after 1 week)

## Emergency Contacts
- **Primary:** Lead Engineer
- **Secondary:** Database Administrator  
- **Escalation:** Engineering Manager

## Cleanup (1 Week Post-Migration)
```sql
-- After successful migration and verification period
DROP TABLE IF EXISTS artists_youtube_migration_backup;

-- Remove old database dump files
rm youtube_migration_backup_*.sql
```

## Testing History
- **Development Testing:** ✅ Completed successfully
- **Migration Logic:** ✅ All 6 test cases passed validation
- **Rollback Testing:** ✅ Backup/restore functionality verified
- **Production Readiness:** ✅ Script ready for production deployment 