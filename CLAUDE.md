# stashpile

An iOS app that downloads Reddit, Hacker News, and RSS (including NYT) content on a schedule for offline reading during subway commutes. Built with React Native (Expo) and backed by AWS infrastructure.

## Repo structure

```
stashpile/
├── apps/mobile/          # Expo app (TypeScript, React Native)
│   ├── App.tsx           # Root component and feed list UI
│   └── src/
│       ├── db/           # SQLite offline storage (expo-sqlite)
│       ├── services/     # Reddit, HN, RSS fetchers + sync orchestrator
│       └── types/        # Shared TypeScript types
├── infrastructure/
│   ├── modules/server/   # Reusable Terraform module (EC2 dev server)
│   ├── environments/
│   │   ├── dev/          # Dev environment Terraform root (S3 backend)
│   │   └── prod/         # Prod environment Terraform root (not yet applied)
│   └── scripts/          # Deployment and infrastructure scripts
└── .github/workflows/    # GitHub Actions (workflow_dispatch deploy)
```

## AWS credentials

Scripts load credentials from `.env.<environment>` if present. If that file does not exist, they fall back to AWS environment variables already set in the shell (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION`). In Claude Code cloud, supply these environment variables directly — no `.env.dev` file is needed.

Required variables:
```
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_DEFAULT_REGION=us-east-1
```

## Dev environment

The dev server is a t3.small EC2 instance in us-east-1 that runs the Expo Metro bundler. It is stopped when not in use to save cost.

| Resource | Value |
|---|---|
| Instance ID | `i-0dfa7e803549fa309` |
| Public IP (stable) | `54.156.78.75` |
| S3 sync bucket | `stashpile-dev-sync-978850043818` |
| Terraform state bucket | `stashpile-tfstate-978850043818` |

## How to use the dev deployment

**Start the server and deploy latest code:**
```bash
bash infrastructure/scripts/start-dev dev
```

This starts the EC2 instance, waits for it to be ready, syncs the app code from S3, and restarts the Expo bundler. It prints the Expo URL when done.

**Connect your phone:**
Open Safari on your iPhone and navigate to:
```
exp://54.156.78.75:8081
```
iOS will open the URL in Expo Go. Metro takes ~15 seconds to bundle on first load.

**Deploy code changes without restarting the instance:**
```bash
bash infrastructure/scripts/deploy dev
```
Syncs `apps/mobile/` to S3 (excluding `node_modules/` and `.expo/`), then triggers the instance to pull and restart Expo via SSM.

**Stop the server when done:**
```bash
bash infrastructure/scripts/stop-dev dev
```

**Open an SSM shell on the instance:**
```bash
aws ssm start-session --target i-0dfa7e803549fa309
```

## Terraform

All Terraform commands go through the wrapper script which handles credentials and the correct working directory:

```bash
bash infrastructure/scripts/tf dev plan
bash infrastructure/scripts/tf dev apply
bash infrastructure/scripts/tf dev output
```

The dev environment state is stored remotely in S3 — no local state file. Re-initialising is safe:
```bash
bash infrastructure/scripts/tf dev init
```

## GitHub Actions

A manual workflow dispatch is available at Actions → Deploy. It runs `tf apply` then deploys code to the target environment. Authenticate via OIDC — no secrets required, just the `AWS_ROLE_ARN` variable set on the GitHub environment.

## Mobile app development

The app source lives entirely in `apps/mobile/`. Key files:

- `App.tsx` — feed list, sync button, mark-as-read
- `src/db/index.ts` — SQLite schema, upsert, queries
- `src/services/reddit.ts` — Reddit public JSON API
- `src/services/hackernews.ts` — HN Firebase API
- `src/services/rss.ts` — minimal RSS/Atom parser (no native DOM)
- `src/services/sync.ts` — orchestrates all feeds, `syncAllFeeds()`

Default feeds (seeded on first launch): HN Top, r/worldnews, r/technology, NYT Homepage RSS.

To add a new subreddit or RSS feed, call `upsertFeedConfig()` from `src/db/index.ts` with a new `FeedConfig` entry.

## Adding a new environment

1. Copy `infrastructure/environments/dev/` to `infrastructure/environments/<env>/`
2. Update `environment`, `instance_type`, and backend `key` in `main.tf`
3. Create `.env.<env>` with credentials for that AWS account (or set env vars)
4. Run `bash infrastructure/scripts/bootstrap <env>` to create the state bucket
5. Run `bash infrastructure/scripts/tf <env> init`
6. Run `bash infrastructure/scripts/tf <env> apply`
