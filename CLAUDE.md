# Paperclip — Fork Workflow

This is a personal fork of `paperclipai/paperclip`.

## Git Remotes

- `origin` — fork (`early6AM/paperclip`) — push here
- `upstream` — original (`paperclipai/paperclip`) — pull from here

## Branch Strategy

Each feature lives in its own branch for a clean PR to upstream.
A personal `my/integration` branch merges all features together for local use.

```
master (synced with upstream)
 ├── feat/<feature-name>     ← one branch per PR
 └── my/integration          ← merges ALL feature branches for local use
```

### New feature

```bash
git checkout master
git checkout -b feat/<feature-name>
# ... work, commit ...
git push -u origin feat/<feature-name>
# Create PR: gh pr create --repo paperclipai/paperclip --head early6AM:feat/<feature-name> --base master
```

### Update integration branch

```bash
git checkout my/integration
git merge feat/<feature-name>
git checkout feat/<feature-name>
```

### Sync with upstream

```bash
git fetch upstream
git checkout master
git merge upstream/master

# Rebuild integration (drop already-merged features)
git checkout my/integration
git reset --hard master
git merge feat/still-pending-1
git merge feat/still-pending-2
```

## Project Structure

- `ui/` — React frontend (Vite, TypeScript, Tailwind, shadcn/ui, Radix, react-query)
- `server/` — Express backend (TypeScript, Drizzle ORM, PostgreSQL)
- `packages/shared/` — shared types, validators (Zod)
- `packages/db/` — Drizzle schema definitions

## Code Style

- TypeScript strict mode
- 2-space indentation
- Code comments in English, communication in Russian
- Functional patterns preferred over classes
- localStorage persistence: extract to `ui/src/lib/<name>.ts` + custom hook in `ui/src/hooks/use<Name>.ts` (follow `project-order.ts` / `useProjectOrder.ts` pattern)
- Mutations: use `onSuccess` + `onError` separately (not `onSettled`); invalidate relevant query keys
- Callbacks passed as props: stabilize with `useCallback` to preserve `memo()` effectiveness
- Small helper components can live in the same file (like `FilterButton` in `SidebarAgents.tsx`)

## Type Checking

```bash
# Frontend
cd ui && npx tsc --noEmit --pretty

# Backend
cd server && npx tsc --noEmit --pretty
```
