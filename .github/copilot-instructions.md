# NFL Survivor Pool

## Project Overview
Web app for an NFL survivor/knockout pool. Participants pick one team per week, can't reuse teams, and are eliminated on a loss.

## Tech Stack
- Framework: Next.js 15 (App Router) + TypeScript
- Database: Supabase (PostgreSQL)
- Styling: Tailwind CSS (PostCSS)
- Testing: Vitest
- Data source: Football_2025-54.xlsx - weekly NFL schedule/results

## Build & Test Commands
- npm run dev / npm run build / npm run test / npm run lint

## Architecture Notes
- Supabase schema in /supabase/ - migrations, RLS policies, views
- Participant state machine: ALIVE -> PICKED -> ELIMINATED
- Team reuse rule: cannot pick same NFL team twice. Hard constraint, enforce at DB level.
- Weekly scores come from Excel file; do not hardcode scores or schedules.
- Must handle bye weeks and Thursday/Saturday/Monday games.

## Coding Conventions
- TypeScript strict mode. No any types. Server components by default.
- Supabase RLS on all tables. Input validation on all API routes.
- Vitest tests required for pick validation and elimination rules.

## What NOT To Do
- Do not expose Supabase service role key to the client
- Do not allow picks after a game has started (server-side timestamp check)
- Do not store participant data in local storage
- Do not assume all games are on Sunday
