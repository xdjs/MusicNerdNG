# YouTube URL Handling Refactor Plan

## Overview
Modify the YouTube URL handling logic to properly separate usernames and channel IDs into different database columns, and update the display logic to prefer the @username format when available.

## Database Investigation Results
**Query:** `SELECT * FROM urlmap WHERE site_name ILIKE '%youtube%'`

**Findings:**
- Only **one** YouTube entry exists in the `urlmap` table: `site_name = 'youtubechannel'`
- Current regex handles both channel IDs and usernames but stores everything as `youtubechannel`
- Regex requires `www.` subdomain (missing support for `youtube.com` without www)
- App string format is channel-focused: `https://www.youtube.com/channel/%@`

## Current State
- YouTube usernames and channel IDs are both stored in the `youtubechannel` column
- Backend parses both URL formats but stores everything in `youtubechannel`
- **Database State (from urlmap table):**
  - Only one entry exists: `site_name = 'youtubechannel'`
  - Current regex: `^https:\/\/www\.youtube\.com\/(?:channel\/([^/]+)|@([^/]+))$`
  - App string format: `https://www.youtube.com/channel/%@`
  - **Limitation:** Regex requires `www.` subdomain (doesn't support `youtube.com` without www)
- Currently accepted URL formats:
  - `https://www.youtube.com/@USERNAME` (stored in youtubechannel column)
  - `https://www.youtube.com/channel/CHANNEL_ID` (stored in youtubechannel column)
- **Not currently supported:**
  - URLs without `www.` subdomain (`https://youtube.com/...`)
  - Username format without @ (`https://youtube.com/USERNAME`)

## Desired State
- Store channel IDs in `youtubechannel` column
- Store usernames in `youtube` column
- **Database Changes Required:**
  - Create new `urlmap` entry with `site_name = 'youtube'` for username URLs
  - Update existing `youtubechannel` entry to only handle channel IDs
  - Split current regex into two separate patterns
- **All supported URL formats:**
  - `https://youtube.com/channel/CHANNEL_ID` → stored in `youtubechannel` column
  - `https://www.youtube.com/channel/CHANNEL_ID` → stored in `youtubechannel` column
  - `https://youtube.com/@USERNAME` → stored in `youtube` column
  - `https://www.youtube.com/@USERNAME` → stored in `youtube` column
  - `https://youtube.com/USERNAME` → stored in `youtube` column (new format)
  - `https://www.youtube.com/USERNAME` → stored in `youtube` column (new format)
- Display preference: prefer `https://youtube.com/@USERNAME` if username available, fallback to channel ID format

## Tasks

### 1. Update URL Parsing Logic ✅ COMPLETED
**File:** `src/server/utils/services.ts`
**Function:** `extractArtistId`

- [x] Modify the YouTube URL parsing logic to distinguish between channel IDs and usernames
- [x] Return `siteName: 'youtube'` for usernames
- [x] Return `siteName: 'youtubechannel'` for channel IDs
- [x] Add support for `https://youtube.com/USERNAME` format (without @)
- [x] Ensure regex patterns support both `youtube.com` and `www.youtube.com` domains
- [x] Ensure usernames are stored with @ prefix for consistency
- [x] **🐛 CRITICAL UGC BUG FIX**: Added dedicated parsing logic for `siteName === 'youtube'` platform
- [x] **Tests Required:**
  - [x] Test channel ID extraction returns `youtubechannel` siteName (both domains)
  - [x] Test @username extraction returns `youtube` siteName (both domains)
  - [x] Test username without @ extraction returns `youtube` siteName with @ added (both domains)
  - [x] Test all URL formats work with both `youtube.com` and `www.youtube.com`
  - [x] Test invalid URLs return null

**Implementation Notes:**
- Enhanced `extractArtistId` function to handle comprehensive YouTube URL parsing
- Updated `artistPlatforms` array to include both `'youtube'` and `'youtubechannel'`
- Added comprehensive test coverage for all 6 URL format combinations
- All tests passing (14/14) with TypeScript and ESLint validation
- **🐛 CRITICAL UGC BUG FIX**: The original implementation only had special YouTube parsing logic for `siteName === 'youtubechannel'`. When URLs like `https://www.youtube.com/@fkj` matched the new `youtube` platform, they fell through to generic parsing logic that returned "www." instead of "fkj". Added dedicated parsing logic for `siteName === 'youtube'` to properly extract usernames from both `@username` and `username` formats.
- **Bug Impact**: UGC submissions for YouTube usernames were storing incorrect data (e.g., "www." instead of "fkj")
- **Fix Applied**: Added proper YouTube username extraction logic for the dedicated `youtube` platform
- **Commit:** `9cae35f` - Implement YouTube URL parsing refactor Task 1

### 2. Update URL Construction/Display Logic ✅ COMPLETED
**File:** `src/server/utils/queries/artistQueries.ts`
**Function:** `getArtistLinks`

- [x] Update the special handling for YouTube links
- [x] Add logic to check both `youtube` and `youtubechannel` columns
- [x] Prefer displaying @username format when `youtube` column has data
- [x] Fallback to channel ID format only when `youtube` column has no data but `youtubechannel` has data
- [x] Handle case where both columns have data (prefer username)
- [x] **Tests Required:**
  - [x] Test username display generates correct @username URL
  - [x] Test channel ID display generates correct channel URL
  - [x] Test preference logic when both username and channel ID exist
  - [x] Test empty/null values don't generate links

**Implementation Notes:**
- Enhanced `getArtistLinks` function with comprehensive YouTube URL construction logic
- Implemented preference system: `youtube` column (username) takes priority over `youtubechannel` column
- Added support for both dedicated `youtube` platform and legacy `youtubechannel` platform handling
- URL formats: `https://youtube.com/@username` (preferred) and `https://www.youtube.com/channel/CHANNEL_ID` (fallback)
- Proper handling of `@` prefix, whitespace trimming, and edge cases (empty/null values)
- Smart detection for username data stored in `youtubechannel` column (legacy state)
- Added 7 comprehensive tests covering all scenarios with 100% pass rate
- **Tests covering:** preference logic, username/channel ID display, legacy state handling, dedicated platform, empty values, whitespace handling
- All existing functionality remains backwards compatible

### 3. Update Database Schema and Types ✅ COMPLETED
**Files:** `drizzle/schema.ts`, `src/server/db/schema.ts`

- [x] Verify `youtube` and `youtubechannel` columns exist in artists table
- [x] Update any type definitions if needed
- [x] **Tests Required:**
  - [x] Verify database schema matches expectations
  - [x] Test that both columns can store data independently

**Implementation Notes:**
- Verified both `youtube` and `youtubechannel` columns exist in the database schema (ordinal positions 11 and 12)
- Both columns are properly typed as `text` and nullable, matching our expectations
- TypeScript types are automatically generated via Drizzle ORM's `InferSelectModel`, no manual updates needed
- Generated Supabase types show both columns as `string | null` which is correct
- Database query confirmed both columns can store data independently (Tyler, The Creator has data in both)
- Added comprehensive test verifying Artist type includes both YouTube columns with proper TypeScript compilation
- All existing type definitions remain valid and compatible

### 4. Update URL Validation Logic ✅ COMPLETED
**File:** `src/app/api/validateLink/route.ts`

- [x] Update YouTube regex to handle both username formats and channel IDs
- [x] Ensure regex supports both `youtube.com` and `www.youtube.com` domains
- [x] Add separate validation for `youtube` siteName if needed
- [x] Ensure validation works with both URL formats
- [x] **Tests Required:**
  - [x] Test validation for channel ID URLs (both domains)
  - [x] Test validation for @username URLs (both domains)
  - [x] Test validation for username URLs without @ (both domains)
  - [x] Test validation rejection for invalid YouTube URLs

**Implementation Notes:**
- Split YouTube validation into two separate platforms: `youtube` and `youtubechannel`
- Updated regex patterns to handle all 6 supported URL formats:
  - `youtube` platform: `/^https?:\/\/(www\.)?youtube\.com\/(?:@([^/]+)|([^/]+))$/` (matches username URLs)
  - `youtubechannel` platform: `/^https?:\/\/(www\.)?youtube\.com\/channel\/([^/]+)$/` (matches channel ID URLs)
- Both platforms support optional `www` subdomain and use the same error phrases for consistency
- Added 12 comprehensive tests covering all scenarios:
  - ✅ Valid @username URLs (with and without www)
  - ✅ Valid username URLs without @ (with and without www)  
  - ✅ Valid channel ID URLs (with and without www)
  - ✅ Invalid URL format rejection (regex-based and network-based)
  - ✅ 404 response handling
  - ✅ Error phrase detection in content
  - ✅ Generic unsupported platform rejection
- All tests passing (12/12) with proper error handling for both regex rejection and network failures

### 5. Update URL Mapping Configuration ✅ COMPLETED
**Files:** Database `urlmap` table entries

- [x] **Create new `urlmap` entry for `youtube` siteName:**
  - [x] `site_name = 'youtube'`
  - [x] `regex = '^https://(www\.)?youtube\.com\/(?:@([^/]+)|([^/]+))$'` (matches @username and username formats)
  - [x] `app_string_format = 'https://youtube.com/@%@'` (always display with @ prefix)
  - [x] Copy other fields from existing youtubechannel entry:
    - [x] `card_platform_name = 'YouTube'`
    - [x] `color_hex = '#FF0000'`
    - [x] `platform_type_list = '{social}'`
    - [x] `card_description = 'Watch their videos on %@'`
    - [x] `site_url = 'youtube.com'`
- [x] **Update existing `youtubechannel` entry:**
  - [x] Change regex to `'^https://(www\.)?youtube\.com\/channel\/([^/]+)$'` (only channel IDs)
  - [x] Keep existing `app_string_format = 'https://www.youtube.com/channel/%@'`
- [x] **Tests Required:**
  - [x] Test channel ID regex only matches channel URLs
  - [x] Test username regex matches @username and plain username formats
  - [x] Test both regexes support optional www subdomain
  - [x] Test `appStringFormat` generates correct URLs for each type

**Implementation Notes:**
- Both `youtube` and `youtubechannel` entries exist in database with correct configurations
- `youtube` entry handles username URLs with regex supporting both @username and plain username formats
- `youtubechannel` entry updated to only handle channel ID URLs
- Both entries support optional www subdomain and have proper app_string_format
- Database entries updated on 2025-07-22 and verified working
- **Database verification:** Both urlmap entries confirmed present and properly configured

### 6. Update UGC Approval Logic ✅ COMPLETED
**File:** `src/server/utils/queries/artistQueries.ts`
**Function:** `approveUGC`

- [x] Ensure UGC approval correctly handles both `youtube` and `youtubechannel` platforms
- [x] Test that approvals update the correct database columns
- [x] **Tests Required:**
  - [x] Test UGC approval for YouTube username updates `youtube` column
  - [x] Test UGC approval for YouTube channel ID updates `youtubechannel` column

**Implementation Notes:**
- Updated `promptRelevantColumns` array to include both `'youtube'` and `'youtubechannel'` for bio regeneration
- Enhanced `generateArtistBio` function to include YouTube username data in AI prompt generation
- Updated `getOpenAIBio` function to include YouTube username data in AI prompt generation
- Added comprehensive tests for both YouTube platforms (4 new test cases)
- Verified bio regeneration triggers correctly for both `youtube` and `youtubechannel` platforms
- All existing functionality remains backwards compatible
- **Tests passing:** 10/10 UGC approval tests passing including new YouTube-specific tests

### 7. Update Frontend Components ✅ COMPLETED
**Files:** Various components that display YouTube links

- [x] Review `src/app/_components/ArtistLinks.tsx` for any hardcoded YouTube logic
- [x] Update any components that specifically handle YouTube display
- [x] **Tests Required:**
  - [x] Test YouTube links render correctly in artist link lists
  - [x] Test both username and channel ID formats display properly

**Implementation Notes:**
- **ArtistLinks.tsx**: ✅ No hardcoded YouTube logic found - properly uses backend `getArtistLinks()` function
- **SearchBar.tsx**: ✅ Fixed 4 instances of hardcoded YouTube logic:
  - Updated WalletSearchBar to check for both `result.youtube` and `result.youtubechannel`
  - Updated NoWalletSearchBar to check for both `result.youtube` and `result.youtubechannel`
  - Updated SocialIcons component to check for both YouTube data types
  - Updated SearchResults component to check for both YouTube data types
- **Comprehensive test coverage**: ✅ Added 2 new test files:
  - `ArtistLinks.test.tsx`: 5 tests covering username/channel preference, link rendering for both formats, monetized vs social sections
  - `SearchBarYoutube.test.tsx`: 7 tests covering YouTube icon display for username, channel, both, none, mixed platforms, multiple results, and edge cases
- **SearchBar YouTube icons now correctly display for**:
  - Artists with YouTube username data (`youtube` column)
  - Artists with YouTube channel ID data (`youtubechannel` column)  
  - Artists with both data types (shows single icon)
  - Artists with no YouTube data (shows no icon)
- All existing functionality remains backwards compatible

### 8. Update Platform Lists and Constants ✅ COMPLETED
**File:** `src/server/utils/services.ts`

- [x] Update `artistPlatforms` array if needed to include both `youtube` and `youtubechannel`
- [x] Review any platform filtering logic
- [x] **Tests Required:**
  - [x] Test platform enumeration includes both YouTube types

**Implementation Notes:**
- **✅ artistPlatforms array**: Already included both `youtube` and `youtubechannel` - no changes needed
- **🐛 Fixed platform filtering bugs**:
  - Fixed `removeArtistData` function: Added missing `youtube` to `promptRelevantColumns` array (was only including `youtubechannel`)
  - Fixed `searchForArtistByName` query: Added missing `youtube` column to SELECT statement (was only selecting `youtubechannel`)
- **✅ Comprehensive test coverage**: Added 6 new tests:
  - 3 tests for `artistPlatforms` array: YouTube types inclusion, social platforms, web3 platforms
  - 3 tests for `getArtistSplitPlatforms`: Both YouTube types, single YouTube type handling
- **Critical fixes ensure**:
  - Bio regeneration now triggers correctly for both YouTube platforms when removing artist data
  - Search results now include both YouTube username and channel data
  - Platform enumeration works correctly for both YouTube types

### 9. Update Existing Tests
**Files:** Various test files

- [ ] Update `__tests__/UrlPatternRegex.js` to test both formats
- [ ] Update `src/server/utils/__tests__/services.test.ts` YouTube tests
- [ ] Update `src/__tests__/api/validateLink.test.ts` YouTube validation tests
- [ ] Update any other tests that mock or test YouTube functionality
- [ ] **All URL formats to test:**
  - [ ] `https://youtube.com/channel/CHANNEL_ID`
  - [ ] `https://www.youtube.com/channel/CHANNEL_ID`
  - [ ] `https://youtube.com/@USERNAME`
  - [ ] `https://www.youtube.com/@USERNAME`
  - [ ] `https://youtube.com/USERNAME` (new format)
  - [ ] `https://www.youtube.com/USERNAME` (new format)
- [ ] **Tests to Update:**
  - [ ] URL pattern regex tests for new username format
  - [ ] `extractArtistId` tests for correct siteName returns
  - [ ] Validation API tests for all YouTube formats
  - [ ] Artist link generation tests

### 10. Data Migration Strategy
**Considerations for existing data**

- [ ] **Current urlmap table state:** Only one entry exists for YouTube (`youtubechannel`)
- [ ] **Artists table migration:** Analyze existing data in `youtubechannel` column to identify usernames vs channel IDs
- [ ] Create migration script to move usernames from `youtubechannel` to `youtube` column
- [ ] **Database Changes Required:**
  - [ ] **Phase 1:** Create new `youtube` urlmap entry (can be done safely)
  - [ ] **Phase 2:** Update parsing logic to use correct siteName for each URL type
  - [ ] **Phase 3:** Migrate existing artist data from `youtubechannel` to `youtube` for usernames
  - [ ] **Phase 4:** Update existing `youtubechannel` urlmap entry regex
- [ ] **Migration Tasks:**
  - [ ] Query existing `youtubechannel` artist data to identify usernames (starts with @) vs channel IDs (starts with UC)
  - [ ] Create backup of existing data
  - [ ] Write migration script to move usernames to `youtube` column
  - [ ] Test migration script on sample data
  - [ ] Plan rollback strategy

### 11. Integration Testing
**End-to-end testing**

- [ ] Test complete flow: URL submission → parsing → storage → display
- [ ] Test with both username and channel ID URLs on both domains
- [ ] Test edge cases and error conditions
- [ ] **Integration Tests:**
  - [ ] Submit YouTube channel URL and verify storage/display (both domains)
  - [ ] Submit YouTube username URL and verify storage/display (both domains)
  - [ ] Submit new username format URL and verify storage/display (both domains)
  - [ ] Test artist page displays YouTube links correctly
  - [ ] Verify all 6 URL format combinations work end-to-end

### 12. Documentation Updates
**Update any relevant documentation**

- [ ] Update API documentation if applicable
- [ ] Update developer documentation about URL handling
- [ ] Update any user-facing documentation about supported URL formats

## Risk Assessment

### High Risk
- **Data Migration**: Moving existing data between columns could cause data loss
- **Breaking Changes**: Changes to parsing logic could affect existing functionality

### Medium Risk
- **Display Logic**: Changes to link generation could break existing links
- **Validation**: Changes to validation could reject previously valid URLs

### Low Risk
- **New URL Format**: Adding support for new format should be additive
- **Test Updates**: Updating tests is straightforward but time-consuming

## Testing Strategy

1. **Unit Tests First**: Update all unit tests to define expected behavior
2. **Component Tests**: Test individual components in isolation
3. **Integration Tests**: Test complete user flows
4. **Manual Testing**: Verify UI behavior and edge cases
5. **Migration Testing**: Test data migration on sample data before production

## Rollout Strategy

1. **Phase 1**: Database Setup (Safe, no breaking changes)
   - Create new `youtube` urlmap entry
   - Deploy updated parsing logic to handle both siteNames correctly
   - Test that new URLs are parsed and stored in correct columns

2. **Phase 2**: Update Display Logic 
   - Update `getArtistLinks` to handle both `youtube` and `youtubechannel` columns
   - Implement preference logic (prefer username format)
   - Test display logic with mixed data

3. **Phase 3**: Data Migration
   - Backup existing artist data
   - Run migration script to move usernames from `youtubechannel` to `youtube` columns
   - Verify migration success

4. **Phase 4**: Finalize and Clean Up
   - Update existing `youtubechannel` urlmap regex to only handle channel IDs
   - Add support for new username format (`youtube.com/USERNAME`)
   - Remove any deprecated code paths

## Success Criteria

- [ ] All existing YouTube functionality continues to work
- [ ] New username format URLs are accepted and processed correctly
- [ ] Usernames are stored in `youtube` column, channel IDs in `youtubechannel`
- [ ] Display logic prefers @username format when available
- [ ] All tests pass
- [ ] No data loss during migration
- [ ] Performance impact is minimal

## Rollback Plan

- [ ] Database backup before migration
- [ ] Ability to revert code changes
- [ ] Script to move data back to original columns if needed
- [ ] Monitoring to detect issues quickly 