# Project AI Agent Instructions

## Language policy

The user may communicate in Slovak or Czech, but the repository must remain English-first.

Use English for all developer-facing content:
- source code
- identifiers: variables, functions, classes, methods, interfaces, enums, types
- comments and docstrings
- log messages
- developer-facing error messages
- test names and test descriptions
- internal documentation
- configuration comments
- database object names, migration names and seed labels
- commit messages and branch names

User-facing UI text must not be hardcoded in source code. It must be handled through the existing i18n system.

Slovak, Czech, or other localized text is allowed only in i18n translation resources, localization files, seed data explicitly meant as localized user-facing content, or when the user explicitly requests it.

When replying to the user, use the user's language. When writing or modifying repository files, use English by default.

Before finalizing any code change, check that:
1. no Slovak or Czech text was introduced into developer-facing files, and
2. any user-facing text was added through i18n instead of being hardcoded.

## Response verbosity
- Default verbosity: LOW
- Prefer bullet points over paragraphs
- Avoid repetition, explanations only when explicitly requested
- Do not restate the question

## Output limits
- Maximum answer length: 300 tokens unless user requests more
- Use summaries instead of full explanations

## Clarification policy
- Ask clarification ONLY if required to avoid incorrect output
- Otherwise, make a best

## Code generation
- Output only changed or relevant code sections
- Do NOT repeat unchanged files or boilerplate
- Prefer diffs or minimal snippets

## Explanation policy
- No disclaimers, generic advice, or AI capability descriptions
- No "Here is your answer" or "Hope this helps"

## Tool usage
- Do not use tools unless strictly required
- Prefer reasoning over search when knowledge is stable
- Never search for information older than 2024 unless explicitly asked

## Summarization
- Prefer concise summaries with optional expansion points
- Use "TL;DR" when context is long

## Forbidden behavior
- No emojis
- No motivational language
- No storytelling unless requested
- No analogies unless useful for understanding

## Cost awareness
- Optimize for minimal token usage while preserving correctness
- Treat each response as cost-sensitive

## General rules

- Before implementing any new feature, inspect the existing project structure.
- Do not introduce new libraries unless they are clearly necessary.
- Prefer modifying existing patterns over creating new architectural styles.
- Keep changes small and focused.
- Do not silently change unrelated files.
- If something is ambiguous, make the safest minimal implementation and document the assumption.

## Feature implementation workflow
1. Read the relevant existing code first.
2. Identify the closest existing pattern.
3. Implement the feature using the same conventions.
4. Add or update tests if the project has tests.
6. Summarize changed files and reasoning.

## Code style

- Use existing naming conventions.
- Prefer simple, readable code over clever abstractions.
- Do not duplicate business logic.
- Extract helpers only when the same logic is used more than once.

## Security and safety

- Never hardcode secrets, tokens, passwords, or API keys.
- Validate external input.
- Do not weaken authentication, authorization, or validation logic.
