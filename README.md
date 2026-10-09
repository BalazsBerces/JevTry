# Task API

Small in-memory task management REST API (Node.js + Express). Data is lost on restart.

## Install

    npm install

## Run

    npm start

Listens on port 3000 (override with the `PORT` environment variable).

## Test

    npm test

Uses `node:test` with `supertest`. The app is exported from `src/app.js` (`createApp()`), so tests never start a listening server.

## Data model

User: `{ "id": number, "name": string }`

Task: `{ "id": number, "title": string, "completed": boolean, "assigneeId"?: number, "dependencies"?: number[], "dueDate"?: string }`

The optional task fields are omitted from responses when unset (no assignee, no dependencies, no due date), so V1 clients see the same shape as before.

## Endpoints

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| GET | /tasks | - | 200 list | - |
| GET | /tasks?overdue=true | - | 200 overdue tasks | 400 (value not `true`/`false`) |
| GET | /tasks?overdue=false | - | 200 tasks that are not overdue | 400 |
| POST | /tasks | `{ title, completed?, assigneeId?, dependencies?, dueDate? }` | 201 task | 400, 409 |
| PUT | /tasks/:id | `{ title?, completed?, assigneeId?, dependencies?, dueDate? }` (at least one) | 200 task | 400, 404, 409 |
| DELETE | /tasks/:id | - | 204 | 400, 404, 409 |
| GET | /users | - | 200 list | - |
| POST | /users | `{ name }` | 201 user | 400 |
| GET | /users/:id/tasks | - | 200 tasks assigned to the user | 400, 404 |
| DELETE | /users/:id | - | 204 | 400, 404, 409 |

Errors return `{ "error": "message" }`. Invalid ids (not a positive integer), empty or non-string titles/names, non-boolean `completed`, and malformed JSON give 400; unknown task or user ids in the path give 404.

Validation order: malformed request / field format (400) → resource in the path not found (404) → references in the body (400) → business-rule conflicts (409). A rejected request never partially applies.

## Business rules

### Users
- `name` is required, must be a non-empty string, and is trimmed.
- User ids are unique positive integers, assigned sequentially and never reused (even after deletion). User and task ids are independent sequences.

### Task ownership
- `assigneeId` is optional. It must be a positive integer referencing an existing user, otherwise 400.
- On `PUT`, `assigneeId: null` unassigns the task.
- `GET /users/:id/tasks` returns every task (complete or not) whose `assigneeId` is that user.
- `DELETE /users/:id` returns 409 while any task (complete or not) is assigned to the user. Unassign or delete those tasks first.

### Dependencies
- `dependencies` is an optional array of positive integer task ids that must all be completed before this task can be completed.
- Every id must refer to an existing task (400), the array must not contain duplicates (400), and a task may not depend on itself (400).
- On `PUT`, `dependencies` replaces the whole list; `[]` clears it.
- A change that would create a cycle, direct or transitive at any depth (e.g. 1 → 3 → 2 → 1), is rejected with 409. Detection is an iterative graph traversal, so deep chains do not hit recursion limits.
- A task cannot be completed while any of its dependencies is incomplete: 409. This applies to `PUT { completed: true }`, to `POST` with `completed: true`, and to adding an incomplete dependency to an already-completed task.
- Marking a task incomplete is always allowed, even if completed tasks depend on it.
- Deleting a task that other tasks depend on returns 409; remove it from their `dependencies` first. This keeps dependency references valid.

### Deadlines
- `dueDate` is optional and must be an ISO 8601 UTC timestamp of the form `YYYY-MM-DDTHH:mm:ssZ` or `YYYY-MM-DDTHH:mm:ss.sssZ` (1-3 fractional digits). Other formats, non-UTC offsets, and impossible dates such as `2026-02-30T00:00:00Z` give 400.
- Stored and returned normalized to `YYYY-MM-DDTHH:mm:ss.sssZ`.
- On `PUT`, `dueDate: null` clears it.
- A task is overdue when it is incomplete, has a `dueDate`, and that `dueDate` is strictly earlier than the current time. Tasks without a `dueDate` are never overdue.

`createApp({ now })` accepts an optional clock function (milliseconds since epoch, defaults to `Date.now`), used by tests to make overdue filtering deterministic.
