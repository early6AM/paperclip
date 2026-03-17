# Design: `startsAt` Field for Issues, Goals, and Projects

**Date:** 2026-03-16
**Status:** Approved

---

## Problem

When agents decompose projects into tasks months in advance, they have no way to express "this task should not be worked on before a certain date." Agents begin work prematurely, releasing features before users are ready. This is especially problematic for phased rollouts, marketing campaigns, and any time-gated work.

---

## Solution Overview

Add an optional `startsAt` (timestamp) + `startsAtPrecision` (enum) pair to issues, goals, and projects. Tasks with a future effective start date are hidden from agents' "ready to work" lists. Agents can see the field in the API and understand when work is appropriate to begin.

---

## Design Decisions

| Question | Decision |
|----------|----------|
| Single timestamp or separate date/time fields? | Single timestamp + precision enum |
| Precision options | `"day"`, `"week"`, `"month"`, `"datetime"` |
| Blocking behavior | Soft block — hidden from "ready to work", not hard-forbidden |
| Scope | Issues, goals, and projects |
| `effectiveStartsAt` inputs | Issue's own `startsAt` + direct `projectId → project.startsAt` only |
| Goal excluded from inheritance | `goalId` can be auto-assigned via `resolveIssueGoalId()` (company default goal); using it for time constraints would apply unintended scheduling to most issues |

---

## Why Not Goal-Level Inheritance

The `resolveIssueGoalId()` function in `server/src/services/issue-goal-fallback.ts` auto-assigns a company default `goalId` to issues that have neither an explicit `projectId` nor `goalId`. This means a large portion of existing issues have a `goalId` that points to an organizational default, not a user-defined parent for scheduling purposes.

Using `goal.startsAt` in `effectiveStartsAt` would cause: setting `startsAt` on the company default goal → accidentally blocks all auto-assigned issues. This is incorrect behavior.

`effectiveStartsAt` therefore considers only:
1. The issue's own `startsAt`
2. The issue's direct `projectId → project.startsAt` (one LEFT JOIN)

Goals still have `startsAt` fields — agents can set them when planning, and they appear in GoalProperties UI — but they do not flow into `effectiveStartsAt` on issues. If a goal's constraint should apply to issues, the project containing the goal should have `startsAt` set.

---

## 1. Data Layer

### Schema changes

Three tables each receive two nullable columns:

```sql
-- issues, goals, projects (identical columns)
starts_at           TIMESTAMP WITH TIME ZONE   -- nullable, no default
starts_at_precision TEXT CHECK (starts_at_precision IN ('day', 'week', 'month', 'datetime'))
                                               -- nullable, no default
```

Both columns are `nullable` with no database-level default. The CHECK constraint prevents invalid precision values at the DB level. A Drizzle migration is required for each table.

### Shared types (`packages/shared/src/types/`)

```typescript
export type StartsAtPrecision = "day" | "week" | "month" | "datetime";

// Added to Goal and Project interfaces:
startsAt: Date | null;
startsAtPrecision: StartsAtPrecision | null;

// Added to Issue interface:
startsAt: Date | null;
startsAtPrecision: StartsAtPrecision | null;
effectiveStartsAt: Date | null;  // read-only, computed by server
```

### Validation rules

Enforced by Zod (`z.string().datetime()` — ISO 8601 UTC with timezone offset), applied to `createIssueSchema`, `updateIssueSchema`, and their equivalents for goals/projects:

```typescript
startsAt: z.string().datetime().nullable().optional(),
startsAtPrecision: z.enum(["day", "week", "month", "datetime"]).nullable().optional(),
```

Server-side rules (applied before DB write):
- `startsAt` set, `startsAtPrecision` omitted or null → default `startsAtPrecision` to `"day"`
- `startsAtPrecision` set, `startsAt` null → return 400 validation error
- `startsAt: null` in a PATCH → server automatically sets `startsAtPrecision` to null (client does not need to send both)
- Both null → no constraint

---

## 2. API Layer

### Date format

All `startsAt` values in the API are **ISO 8601 UTC strings** (e.g., `"2026-06-01T00:00:00.000Z"`). Agents must use ISO 8601 UTC format.

### Heartbeat-context endpoint

`GET /api/issues/:id/heartbeat-context` gains three new fields:

```json
{
  "issue": {
    "startsAt": "2026-06-01T00:00:00.000Z",
    "startsAtPrecision": "month",
    "effectiveStartsAt": "2026-07-01T00:00:00.000Z"
  }
}
```

- `startsAt` / `startsAtPrecision` — the issue's own values (may be null)
- `effectiveStartsAt` — `MAX(issue.starts_at, project.starts_at)`, computed in the route handler via a **single SQL query with one LEFT JOIN** on `issues.project_id → projects.id`. Not computed via sequential `await` calls (to avoid race conditions). Read-only; not stored.

### "Ready to work" filtering

`IssueFilters` interface in `server/src/services/issues.ts` gains a new field:

```typescript
interface IssueFilters {
  // ... existing fields ...
  excludeScheduled?: boolean;
}
```

When `excludeScheduled: true`, the following condition is added as an **independent AND clause** alongside the existing `status` and other filters (not replacing them):

```sql
AND (
  GREATEST(issues.starts_at, projects.starts_at) IS NULL
  OR GREATEST(issues.starts_at, projects.starts_at) <= NOW()
)
```

Implemented via LEFT JOIN on `issues.project_id → projects.id`.

The `excludeScheduled` flag is enabled by default on agent-facing list endpoints (heartbeat, agent task queue). User-facing list endpoints pass `excludeScheduled: false` so scheduled issues remain visible in the UI.

**Scope of the soft block:**
- `excludeScheduled` applies only to issues with `status != 'in_progress'`; the WHERE clause includes `OR issues.status = 'in_progress'` to keep active work visible
- Issues reverted from `in_progress` to `backlog`/`todo` are re-subject to the filter on next query
- `checkout()` is not modified

### Standard CRUD endpoints

`GET /api/issues/:id`, `POST /api/issues`, `PATCH /api/issues/:id` include `startsAt` and `startsAtPrecision` in request/response. `effectiveStartsAt` is returned in GET responses (read-only; not accepted in write requests). Same pattern for goals and projects (which do not expose `effectiveStartsAt`).

### API Reference update

`skills/paperclip/references/api-reference.md` is updated with:

- `startsAt` (ISO 8601 UTC, nullable) — when work on this entity should begin
- `startsAtPrecision` (nullable enum):
  - `"month"` — approximate, sometime during that month
  - `"week"` — approximate, sometime during that week
  - `"day"` — approximate, on that day (default when omitted)
  - `"datetime"` — exact, down to the second
- `effectiveStartsAt` (ISO 8601 UTC, nullable, read-only, issues only) — `MAX(issue.startsAt, project.startsAt)`; controls agent eligibility
- Errors: `startsAtPrecision` without `startsAt` → 400; `startsAt: null` automatically clears `startsAtPrecision`
- **Agents: check `effectiveStartsAt` (not `startsAt`) before beginning work**
- Agents can set/clear `startsAt` on issues, goals, and projects via PATCH

---

## 3. UI

### Display

**`IssueProperties.tsx`** — adds a `Starts` property row. If `effectiveStartsAt` differs from issue's own `startsAt` (i.e., inherited from project), show the source:

| Precision | Display |
|-----------|---------|
| `"month"` | `Jun 2026` |
| `"week"` | `Week of Jun 1, 2026` |
| `"day"` | `Jun 1, 2026` |
| `"datetime"` | `Jun 1, 2026 09:00` (user's local timezone via `Intl`) |

Inherited example: `Jun 2026  (from project)`

`"datetime"` precision uses a new `formatDateTimeLocal(date)` helper in `ui/src/lib/utils.ts` (wraps `Intl.DateTimeFormat` with hours/minutes). Other precisions use the existing `formatDate()`.

**`GoalProperties.tsx`** — adds a `Starts` property row showing the goal's own `startsAt` only (no inherited display).

**`ProjectProperties.tsx`** — adds a `Starts` property row showing the project's own `startsAt` only.

### "Scheduled" badge

Added to the issue row component that renders status badges (to be confirmed during implementation — likely `IssueRow.tsx` or equivalent in `ui/src/components/`). Triggered by `effectiveStartsAt > now()`. Re-evaluated on each data fetch; no client-side timer.

### Editing

In `IssueProperties.tsx`, `GoalProperties.tsx`, `ProjectProperties.tsx`:
- A `Starts` property row with a date picker and a clear button
- On date selection, precision selector appears: `Day / Week / Month / Exact time` (defaults to `Day`)
- Selecting `Exact time` reveals a time picker (input in local time, serialized to UTC ISO 8601)
- Clearing sends `{ startsAt: null }` only; server auto-clears `startsAtPrecision`

### Creation forms

`startsAt` is hidden under `+ More options` in issue, goal, and project creation forms.

### Activity log

`startsAt` changes are logged via the existing `logActivity()` pattern using activity types `startsAt_set` and `startsAt_cleared`, consistent with how other field changes are logged.

---

## 4. Agent Behavior

Agents will:
1. Receive `effectiveStartsAt` in the heartbeat-context response
2. Check API reference: use `effectiveStartsAt` to determine if work can begin; if `effectiveStartsAt > now()`, the task is not ready
3. Set `startsAt` + `startsAtPrecision` on issues, goals, and projects during project decomposition
4. Clear by sending `{ startsAt: null }` — precision is auto-cleared by the server

Soft block (filtering from "ready to work") is a safety net even if an agent ignores `effectiveStartsAt`.

---

## Files to Change

| File | Change |
|------|--------|
| `packages/db/src/schema/issues.ts` | Add `startsAt`, `startsAtPrecision` (nullable, no default, CHECK) |
| `packages/db/src/schema/goals.ts` | Add `startsAt`, `startsAtPrecision` (nullable, no default, CHECK) |
| `packages/db/src/schema/projects.ts` | Add `startsAt`, `startsAtPrecision` (nullable, no default, CHECK) |
| `packages/db/src/migrations/` | New Drizzle migration |
| `packages/shared/src/types/issue.ts` | Add `StartsAtPrecision`, `startsAt`, `startsAtPrecision`, `effectiveStartsAt` |
| `packages/shared/src/types/goal.ts` | Add `startsAt`, `startsAtPrecision` |
| `packages/shared/src/types/project.ts` | Add `startsAt`, `startsAtPrecision` |
| `packages/shared/src/validators/issue.ts` | Add fields + default/null-clear logic |
| `packages/shared/src/validators/goal.ts` | Add fields + default/null-clear logic |
| `packages/shared/src/validators/project.ts` | Add fields with `z.string().datetime()` |
| `server/src/routes/issues.ts` | Return `effectiveStartsAt` in heartbeat-context (single SQL + LEFT JOIN); update CRUD |
| `server/src/routes/goals.ts` | Update CRUD |
| `server/src/routes/projects.ts` | Update CRUD |
| `server/src/services/issues.ts` | Add `excludeScheduled` to `IssueFilters`; implement filter in `list()` |
| `ui/src/lib/utils.ts` | Add `formatDateTimeLocal()` helper |
| `ui/src/components/IssueProperties.tsx` | Add `Starts` row (date picker, precision, inherited label) |
| `ui/src/components/GoalProperties.tsx` | Add `Starts` row (date picker, precision) |
| `ui/src/components/ProjectProperties.tsx` | Add `Starts` row (date picker, precision) |
| `ui/src/components/IssueRow.tsx` (or equivalent) | Add "Scheduled" badge when `effectiveStartsAt > now()` |
| `skills/paperclip/references/api-reference.md` | Document all new fields, format, semantics, agent guidance |

---

## Out of Scope

- Goal-level inheritance into `effectiveStartsAt` (blocked by auto-assigned `goalId` issue)
- Recursive inheritance (parent issues, parent goals)
- Hard blocking of status transitions
- Calendar view or timeline visualization
- Notifications/reminders
- `endsAt` / deadline field
- Access control for `startsAt`
- Query index optimization (acceptable at current scale for MVP)
