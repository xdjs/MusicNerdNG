# MusicNerdNG Public Repository Preparation Tasks

## 🚨 Security & Privacy Tasks

### 1. **Environment Variables & Secrets**
- [x] **Remove hardcoded secrets**: Check for any hardcoded API keys, passwords, or tokens in the codebase
- [x] **Update `.env.example`**: Create a comprehensive example file showing all required environment variables
- [x] **Verify `.gitignore`**: Ensure all sensitive files are properly ignored (`.env.local`, `.env.*`, etc.)
- [x] **Review environment validation**: Check `src/env.ts` for proper validation of required variables
- [x] **Remove unused GEMINI_API_KEY**: Remove from `src/env.ts`, `src/types/env.d.ts`, `src/server/utils/setup/testEnv.ts`, README.md, and CI workflow

### 2. **Database & API Security**
- [x] **Remove database connection strings**: Ensure no actual database URLs are in the code
- [x] **Sanitize API endpoints**: Remove any hardcoded API keys or tokens
- [x] **Review authentication flows**: Ensure no sensitive auth data is exposed

## 🧹 Code Cleanup Tasks

### 3. **Remove Debug Code**
- [x] **Remove console.log statements**: Found 50+ console.log/error statements throughout the codebase
  - [x] `src/lib/authAdapter.tsx` (4 instances)
  - [x] `src/app/layout.tsx` (1 instance)
  - [x] `src/server/utils/services.ts` (3 instances)
  - [x] `src/app/_components/nav/components/Login.tsx` (6 instances)
  - [x] `src/app/_components/nav/components/SearchBar.tsx` (12 instances)
  - [x] `src/app/artist/[id]/_components/AddArtistData.tsx` (4 instances)
  - [x] `src/app/api/coverage/route.ts` (2 instances)
  - [x] `src/app/api/artistBio/[id]/route.ts` (1 instance)
  - [x] `src/app/api/test-log/route.ts` (1 instance) - DELETED
  - [x] `src/app/actions/addArtist.ts` (8 instances)
  - [x] `src/app/api/leaderboard/route.ts` (1 instance)
  - [x] `src/app/api/validateLink/route.ts` (4 instances)
  - [x] `src/app/api/searchArtists/route.ts` (2 instances)
  - [x] `src/app/api/removeArtistData/route.ts` (1 instance)
  - [x] `src/app/api/admin/whitelist-user/[id]/route.ts` (1 instance)
  - [x] `src/app/profile/Leaderboard.tsx` (1 instance)
  - [x] `src/server/utils/openAIQuery.ts` (1 instance)
  - [x] `src/server/utils/ensClient.ts` (5 instances)
  - [x] `src/app/api/auth/[...nextauth]/route.ts` (3 instances)
  - [x] `src/app/api/pendingUGCCount/route.ts` (1 instance)
  - [x] `src/app/profile/Dashboard.tsx` (1 instance)
  - [x] `src/server/utils/coverage.ts` (4 instances)
  - [x] `src/server/utils/queries/discord.ts` (1 instance)
  - [x] `src/server/utils/queries/artistQueries.ts` (15 instances)
- [ ] **Remove TODO comments**: Found at least one TODO in `artistQueries.ts`
- [ ] **Clean up test logs**: Remove any debug output in test files

### 4. **Code Quality**
- [ ] **Run linting**: `npm run lint` to check for code quality issues
- [ ] **Type checking**: `npm run type-check` to ensure TypeScript is clean
- [ ] **Test coverage**: Ensure adequate test coverage (currently running)

## 📚 Documentation Tasks

### 5. **README Improvements**
- [ ] **Update project description**: Make it more comprehensive and clear
- [ ] **Add screenshots**: Include UI screenshots or demos
- [ ] **Improve setup instructions**: Make installation steps clearer
- [ ] **Add contributing guidelines**: Create CONTRIBUTING.md
- [ ] **Add code of conduct**: Create CODE_OF_CONDUCT.md
- [ ] **Remove GEMINI_API_KEY reference**: Update environment variables section

### 6. **API Documentation**
- [ ] **Expand ApiReadMe.md**: Add more detailed API documentation
- [ ] **Add OpenAPI/Swagger**: Consider adding proper API documentation
- [ ] **Add usage examples**: More comprehensive examples for each endpoint

## 🚀 Deployment & Infrastructure

### 7. **Deployment Configuration**
- [ ] **Add deployment guides**: Instructions for Vercel, Netlify, etc.
- [ ] **Environment setup**: Clear instructions for setting up production environment
- [ ] **Database setup**: Instructions for setting up PostgreSQL/Supabase

### 8. **CI/CD Pipeline**
- [ ] **Add GitHub Actions**: Set up automated testing and deployment
- [ ] **Add status badges**: Add build status, test coverage, etc. to README
- [ ] **Remove GEMINI_API_KEY from CI**: Update `.github/workflows/ci.yml`

## 🧪 Testing & Quality Assurance

### 9. **Test Coverage**
- [ ] **Review test coverage**: Ensure critical paths are tested
- [ ] **Add integration tests**: For API endpoints and user flows
- [ ] **Add E2E tests**: For critical user journeys

### 10. **Performance & Monitoring**
- [ ] **Add performance monitoring**: Consider adding monitoring tools
- [ ] **Error tracking**: Add error reporting (Sentry, etc.)
- [ ] **Analytics**: Add privacy-compliant analytics

## 📦 Package & Dependencies

### 11. **Dependencies**
- [ ] **Update dependencies**: Ensure all packages are up to date
- [ ] **Security audit**: Run `npm audit` to check for vulnerabilities
- [ ] **Lock file**: Ensure `package-lock.json` is committed
- [ ] **Remove unused packages**: Consider removing `@google/generative-ai` if not needed

### 12. **Build Configuration**
- [ ] **Verify build process**: Ensure `npm run build` works correctly
- [ ] **Optimize bundle size**: Check for unnecessary dependencies
- [ ] **Add build scripts**: Consider adding production optimization scripts

## 🔧 Configuration & Setup

### 13. **Configuration Files**
- [ ] **Review all config files**: Ensure no sensitive data in configs
- [ ] **Add configuration examples**: Example files for different environments
- [ ] **Document configuration options**: Clear documentation of all settings

### 14. **Database Schema**
- [ ] **Document database schema**: Add schema documentation
- [ ] **Migration scripts**: Ensure all migrations are properly documented
- [ ] **Seed data**: Add sample data for development

## ⚖️ Legal & Compliance

### 15. **Licensing**
- [ ] **Verify LICENSE file**: Ensure MIT license is appropriate
- [ ] **Third-party licenses**: Check for any license conflicts
- [ ] **Attribution**: Ensure proper attribution for third-party code

### 16. **Privacy & Terms**
- [ ] **Privacy policy**: Add if collecting user data
- [ ] **Terms of service**: Add if providing a service
- [ ] **GDPR compliance**: If applicable

## 🎯 Final Steps

### 17. **Pre-launch Checklist**
- [ ] **Run full test suite**: `npm run ci`
- [ ] **Build verification**: Ensure production build works
- [ ] **Documentation review**: All docs are complete and accurate
- [ ] **Security review**: Final security check
- [ ] **Performance test**: Basic performance validation

### 18. **Repository Setup**
- [ ] **Add issue templates**: GitHub issue templates
- [ ] **Add PR templates**: Pull request templates
- [ ] **Add labels**: Repository labels for issues/PRs
- [ ] **Add topics**: Add relevant GitHub topics
- [ ] **Add description**: Clear repository description

## 🎯 Priority Items

### High Priority (Do First)
1. Remove all console.log statements
2. Remove GEMINI_API_KEY references
3. Create comprehensive `.env.example`
4. Update README with better setup instructions
5. Run security audit on dependencies

### Medium Priority
1. Add contributing guidelines
2. Improve API documentation
3. Add deployment guides
4. Set up CI/CD pipeline

### Low Priority
1. Add analytics/monitoring
2. Performance optimizations
3. Additional documentation

## 📋 Quick Commands

```bash
# Run all checks
npm run ci

# Remove console.log statements (manual review needed)
grep -r "console\." src/ --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx"

# Security audit
npm audit

# Build verification
npm run build

# Test coverage
npm run test:coverage
```

## 🔍 Files to Review

### Environment & Configuration
- `src/env.ts`
- `src/types/env.d.ts`
- `src/server/utils/setup/testEnv.ts`
- `.github/workflows/ci.yml`
- `README.md`

### Security Review
- All API route files in `src/app/api/`
- Authentication files in `src/server/auth.ts`
- Database connection files

### Documentation
- `README.md`
- `ApiReadMe.md`
- `LICENSE`
- `.gitignore`

---

**Note**: This task list should be updated as items are completed. Consider using GitHub Projects or a similar tool to track progress. 