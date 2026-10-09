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

## Endpoints

Task: `{ id, title, completed, assigneeId?, dependencies?, dueDate? }` (optional fields are omitted when unset)

User: `{ "id": number, "name": string }`

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| GET | /tasks | query `overdue=true\|false` optional | 200 list | 400 (bad overdue value) |
| POST | /tasks | `{ title, completed?, assigneeId?, dependencies?, dueDate? }` | 201 task | 400, 409 |
| PUT | /tasks/:id | `{ title?, completed?, assigneeId?, dependencies?, dueDate? }` (at least one) | 200 task | 400, 404, 409 |
| DELETE | /tasks/:id | - | 204 | 400, 404 |
| POST | /users | `{ name }` | 201 user | 400 |
| GET | /users | - | 200 list | - |
| GET | /users/:id/tasks | - | 200 tasks assigned to the user | 400, 404 |
| DELETE | /users/:id | - | 204 | 400, 404, 409 |

Errors return `{ "error": "message" }`. Invalid ids (not a positive integer), empty or non-string titles, non-boolean `completed`, and malformed JSON give 400; unknown ids give 404.

## Business rules

- Ids (tasks and users, separate sequences) are unique positive integers and are never reused.
- User `name` must be a non-empty string (trimmed).
- `assigneeId` is optional; it must be the id of an existing user, otherwise 400. Send `null` on PUT to unassign.
- A user with assigned tasks cannot be deleted (409). Unknown user: 404.
- `dependencies` is an array of task ids. It is rejected with 400 if it is not an array of positive integers, contains duplicates, contains the task's own id, or references a nonexistent task. Send `[]` on PUT to clear.
- A dependency change that would create a cycle of any depth (e.g. A -> B -> C -> A) is rejected with 409. Detection uses an iterative graph traversal, so depth is unbounded.
- A task cannot be completed (POST with `completed: true`, or PUT) while any dependency is incomplete: 409. The same check applies when changing the dependencies of an already completed task. Re-opening a dependency of an already completed task is allowed.
- Deleting a task removes its id from other tasks' `dependencies`.
- `dueDate` is optional: an ISO 8601 UTC timestamp `YYYY-MM-DDTHH:mm:ss[.fraction]Z` that must be a real date, otherwise 400. Send `null` on PUT to clear.
- `GET /tasks?overdue=true` returns incomplete tasks whose `dueDate` is earlier than now. Tasks without a `dueDate` are never overdue. `overdue=false` returns the remaining tasks; any other value gives 400.
- On PUT, a nonexistent task id (404) is reported before validation of `assigneeId`, `dependencies` and `dueDate` contents.
- A failed PUT (400/409) leaves the task unchanged.
