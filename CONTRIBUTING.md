# Contributing to Second Brain

Thank you for contributing to Second Brain! This guide will help you get started and ensure your contributions meet our security and quality standards.

## Getting Started

### 1. Fork & Clone
```bash
git clone https://github.com/YOUR_USERNAME/2ndbrain-v2.git
cd 2ndbrain-v2
```

### 2. Create Feature Branch
```bash
git checkout -b feature/your-feature-name
```

### 3. Set Up Development Environment
```bash
# Install dependencies (if any)
npm install

# Start development server
npm start

# Run tests (if available)
npm test
```

## Code of Conduct

- Be respectful and inclusive
- No harassment, discrimination, or hate speech
- Help others and share knowledge
- Report violations privately to maintainers

## Security First

### Before You Code

1. **Review SECURITY.md**: Understand our security practices
2. **Check for secrets**: Never commit API keys, passwords, or tokens
3. **Verify .gitignore**: Ensure sensitive files won't be committed

### While Coding

#### ✅ DO:
- Use `esc()` function for HTML escaping (prevents XSS)
- Validate all user inputs
- Use Firebase Security Rules for authorization
- Check user UID matches request authentication
- Document security implications of changes
- Keep dependencies up to date
- Use HTTPS URLs only
- Implement rate limiting where appropriate
- Log security-relevant events

#### ❌ DON'T:
- Hardcode API keys or credentials
- Use `eval()` or `Function()` constructors
- Trust client-side validation alone
- Log sensitive user data
- Bypass Firestore security rules
- Use `innerHTML` without escaping
- Store plaintext passwords
- Expose error details to users
- Skip CORS validation
- Use deprecated dependencies

### Security Checklist Before PR

- [ ] No secrets committed (check `.gitignore`)
- [ ] All inputs validated and escaped
- [ ] Firestore rules reviewed
- [ ] No XSS vulnerabilities introduced
- [ ] User permissions properly checked
- [ ] Errors don't leak system information
- [ ] No new dependencies added without audit
- [ ] Performance implications considered

## Commit Guidelines

### Commit Message Format
```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types
- **feat**: New feature
- **fix**: Bug fix
- **docs**: Documentation
- **style**: Code formatting
- **refactor**: Restructuring
- **test**: Tests
- **chore**: Dependencies, config
- **security**: Security improvements

### Examples
```
feat(auth): Add two-factor authentication

fix(payment): Resolve double-charging issue

security(firestore): Add ban user validation

docs(contributing): Update security guidelines
```

## Pull Request Process

### 1. Before Submitting PR
```bash
# Update from main
git fetch origin
git rebase origin/main

# Run tests
npm test

# Check for secrets
git diff origin/main -- | grep -i "key\|secret\|password"
```

### 2. Create Pull Request
- **Title**: Clear, concise description
- **Description**: Explain what and why
- **Security**: Note any security implications
- **Testing**: Describe how you tested

### PR Template
```markdown
## What changed?
Brief description of changes

## Why?
Reason for the changes

## How to test?
1. Step 1
2. Step 2

## Security impact?
- [ ] No impact
- [ ] Low impact (describe)
- [ ] Medium impact (describe)
- [ ] High impact (describe)

## Checklist
- [ ] Tests pass
- [ ] No secrets exposed
- [ ] Documentation updated
- [ ] Code follows style guide
- [ ] Changes are backwards compatible
```

### 3. Review Process
- Maintainer assigns reviewers
- All comments must be addressed
- Changes may be requested
- Approval needed before merge

## Testing Requirements

### Unit Tests
```bash
# Run tests
npm test

# With coverage
npm test -- --coverage
```

### Security Tests
- Verify inputs are escaped
- Test Firestore rules
- Check authorization
- Validate edge cases

### Manual Testing
1. **Happy path**: Normal user flow works
2. **Error handling**: Errors handled gracefully
3. **Edge cases**: Boundary conditions tested
4. **Performance**: No slowdowns introduced
5. **Mobile**: Responsive design works

## Code Style

### JavaScript
- Use `const` by default, `let` if needed, never `var`
- Arrow functions `() => {}` for callbacks
- Template literals for strings: `` `text ${var}` ``
- Comment complex logic
- Max line length: 100 characters

### Functions
```javascript
// ✅ Good
async function updateUserProfile(uid, updates) {
  if (!uid) throw new Error('UID required');
  const user = await getUser(uid);
  if (user.banned) throw new Error('User banned');
  return updateDoc(userDoc(uid), updates);
}

// ❌ Bad
async function updateProfile(u, d) {
  return updateDoc(doc(db, 'users', u), d);
}
```

### Comments
```javascript
// Use comments for WHY, not WHAT
// ✅ Good
// Batch operations to reduce writes (Firestore costs)
const updates = batch();

// ❌ Bad
// Update user data
updateDoc(userDoc(uid), {...});
```

## Documentation

### Update These Files
1. **README.md**: If adding major features
2. **SECURITY.md**: Any security changes
3. **Code comments**: Complex logic
4. **JSDoc**: Public functions

### JSDoc Example
```javascript
/**
 * Validate and ban a user
 * @param {string} uid - User's Firebase UID
 * @param {string} reason - Ban reason
 * @returns {Promise<void>}
 * @throws {Error} If user not found
 * @security Requires admin authentication
 */
async function banUser(uid, reason) { ... }
```

## Common Mistakes & How to Avoid

### ❌ Mistake 1: Committing .env files
```bash
# Check before committing
git status

# Use .env.example instead
cp .env.local .env.example
# Remove secrets from .env.example
```

### ❌ Mistake 2: Not escaping HTML
```javascript
// ❌ Bad - XSS vulnerability
element.innerHTML = userInput;

// ✅ Good
element.textContent = userInput;
// Or use esc() function
element.innerHTML = `<p>${esc(userInput)}</p>`;
```

### ❌ Mistake 3: Trusting client-side auth
```javascript
// ❌ Bad
if (user.plan === 'pro') { enableFeature(); }

// ✅ Good
// Verify on Firestore rules:
allow read: if request.auth.uid == uid;
```

### ❌ Mistake 4: Large files
```bash
# Check file sizes
git ls-files -lS | head

# Use .gitignore for large files
# Or use Git LFS for binaries
```

## Getting Help

### Resources
- [GitHub Discussions](https://github.com/YOUR_ORG/2ndbrain-v2/discussions)
- [Issues](https://github.com/YOUR_ORG/2ndbrain-v2/issues)
- [SECURITY.md](./SECURITY.md)
- [README.md](./README.md)

### Ask Questions
- Comment on relevant issue
- Start a discussion
- Ask in PR review
- Contact maintainers

## Good First Issues

Looking to contribute? Start with issues labeled:
- `good-first-issue`
- `help-wanted`
- `documentation`
- `bug`

## License

By contributing, you agree that your contributions will be licensed under the same license as this project.

## Recognition

Contributors will be recognized in:
- CONTRIBUTORS.md file
- GitHub releases
- Project homepage

---

Thank you for making Second Brain better! 🙏

**Questions?** Open an issue or discussion.
**Found a security issue?** See SECURITY.md for responsible disclosure.

Last Updated: May 13, 2026
