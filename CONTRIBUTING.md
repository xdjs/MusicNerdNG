# Contributing to MusicNerdNG

Thank you for your interest in contributing to MusicNerdNG! This document provides guidelines and information for contributors.

## 🤝 How to Contribute

### Types of Contributions

We welcome various types of contributions:

- **Bug Reports**: Help us identify and fix issues
- **Feature Requests**: Suggest new features or improvements
- **Code Contributions**: Submit pull requests with code changes
- **Documentation**: Improve or add documentation
- **Testing**: Help improve test coverage
- **Design**: Suggest UI/UX improvements

### Getting Started

1. **Fork the repository**
   ```bash
   git clone https://github.com/YOUR_USERNAME/MusicNerdNG.git
   cd MusicNerdNG
   ```

2. **Set up your development environment**
   ```bash
   npm install
   cp .env.example .env.local
   # Edit .env.local with your configuration
   ```

3. **Create a new branch**
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/your-bug-fix
   ```

4. **Make your changes**
   - Follow the coding standards below
   - Write tests for new functionality
   - Update documentation as needed

5. **Test your changes**
   ```bash
   npm run lint
   npm run type-check
   npm run test
   npm run build
   ```

6. **Submit a pull request**
   - Provide a clear description of your changes
   - Reference any related issues
   - Include screenshots for UI changes

## 📋 Development Guidelines

### Code Standards

- **TypeScript**: Use TypeScript for all new code
- **ESLint**: Follow the project's ESLint configuration
- **Prettier**: Use consistent formatting
- **Naming**: Use descriptive variable and function names
- **Comments**: Add comments for complex logic

### Testing Requirements

- **Unit Tests**: Write tests for new utilities and components
- **Integration Tests**: Test API routes and database queries
- **Coverage**: Maintain or improve test coverage
- **E2E Tests**: Add end-to-end tests for critical user flows

### Commit Message Format

Use conventional commit messages:

```
type(scope): description

feat(auth): add wallet connection support
fix(api): resolve artist search pagination issue
docs(readme): update installation instructions
test(utils): add tests for artist validation
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

### Pull Request Guidelines

1. **Title**: Clear, descriptive title
2. **Description**: Explain what and why, not how
3. **Screenshots**: Include for UI changes
4. **Tests**: Ensure all tests pass
5. **Documentation**: Update relevant docs

## 🏗️ Project Structure

```
src/
├── app/                    # Next.js app directory
│   ├── api/               # API routes
│   ├── _components/       # Shared components
│   └── ...
├── components/            # UI components
├── server/               # Server-side utilities
│   ├── db/              # Database configuration
│   └── utils/           # Server utilities
├── lib/                  # Client-side utilities
└── types/               # TypeScript type definitions
```

## 🧪 Testing

### Running Tests

```bash
# Run all tests
npm run test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run specific test file
npm test -- path/to/test.ts
```

### Writing Tests

- Use Jest and React Testing Library
- Test user interactions, not implementation details
- Mock external dependencies
- Test error scenarios

## 🐛 Bug Reports

When reporting bugs, please include:

1. **Environment**: OS, Node.js version, browser
2. **Steps to reproduce**: Clear, step-by-step instructions
3. **Expected behavior**: What should happen
4. **Actual behavior**: What actually happens
5. **Screenshots**: If applicable
6. **Console errors**: Any error messages

## 💡 Feature Requests

When suggesting features:

1. **Problem**: Describe the problem you're solving
2. **Solution**: Explain your proposed solution
3. **Alternatives**: Consider other approaches
4. **Mockups**: Include design mockups if applicable

## 📚 Documentation

### Updating Documentation

- Keep README.md up to date
- Update API documentation in ApiReadMe.md
- Add JSDoc comments for functions
- Update inline comments for complex logic

### Documentation Standards

- Use clear, concise language
- Include code examples
- Add screenshots for UI features
- Keep documentation close to code

## 🔧 Development Setup

### Prerequisites

- Node.js 18+
- PostgreSQL database
- Spotify Developer Account
- OpenAI API Key

### Environment Variables

Copy `.env.example` to `.env.local` and configure:

```bash
# Required
NEXT_PUBLIC_SPOTIFY_WEB_CLIENT_ID=
NEXT_PUBLIC_SPOTIFY_WEB_CLIENT_SECRET=
SUPABASE_DB_CONNECTION=
NEXTAUTH_SECRET=
OPENAI_API_KEY=

# Optional
DISCORD_WEBHOOK_URL=
DISCORD_COVERAGE_URL=
```

### Database Setup

```bash
npm run db:generate
npm run db:push
```

## 🚀 Deployment

### Pre-deployment Checklist

- [ ] All tests pass
- [ ] TypeScript compilation successful
- [ ] ESLint passes
- [ ] Build successful
- [ ] Environment variables configured
- [ ] Database migrations applied

### Deployment Platforms

- **Vercel**: Recommended for Next.js apps
- **Netlify**: Alternative deployment option
- **Self-hosted**: Docker support available

## 🤝 Community

### Getting Help

- **GitHub Issues**: For bugs and feature requests
- **Discussions**: For questions and general discussion
- **Discord**: For real-time chat (if available)

### Code of Conduct

We are committed to providing a welcoming and inclusive environment. Please read our [Code of Conduct](CODE_OF_CONDUCT.md).

## 📄 License

By contributing to MusicNerdNG, you agree that your contributions will be licensed under the MIT License.

## 🙏 Acknowledgments

Thank you to all contributors who have helped make MusicNerdNG better!

---

**Note**: This document is a living document. Please suggest improvements by opening an issue or pull request. 