## Target architecture

- Next.js App Router for web UI and server actions
- PostgreSQL as the primary database
- Prisma as the ORM and migration layer
- Better Auth for authentication and session management
- Worker process for reminders, holiday sync and AI jobs
- OpenAI or Anthropic behind a local provider interface
- MinIO for media and exported assets
- Docker Compose for local and server deployment

## Current state

The current scaffold includes:

- project configuration
- Docker and Compose setup
- PostgreSQL schema draft
- permission catalog
- AI provider abstraction
- worker entrypoint
- placeholder routes for all major modules

## Recommended next steps

1. Copy `.env.example` to `.env` and set a real `AUTH_SECRET`.
2. For a full local deployment, run `docker compose up -d --build`.
3. Open `http://localhost` and verify `http://localhost/api/health`.
4. For local development without Docker, run `npm install`, `npx prisma generate`, `npx prisma db push`, `npm run dev`, and `npm run worker`.

## Migration approach from the legacy app

1. Keep the legacy app as the business reference only.
2. Rebuild users, roles and permissions first.
3. Rebuild services, shift types and conditions.
4. Rebuild schedule and vacations with proper server-side validation.
5. Add reminders and AI generation on top of stable domain services.
