# Sovereign Engineering Rules
Scope: All workspace operations in sovereign-commander-console
Chain Key ID: 360ea36c28e66d9d

## Development Directives
- **Verification First**: Every new feature or bugfix must be accompanied by an automated verification script in `scripts/` or a unit/e2e test.
- **Microkernel Isolation**: Changes to core system files (e.g. `src/services/`) must not break agent runtime boundaries or working memory token budgets.
- **Conventional Commits**: Format commit messages as `type(scope): description` with Chain Key reference.
- **Zero Hallucination**: Every claim of file existence, test passing, or remote sync must be grounded in immediate command execution.
