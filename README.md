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

Task: `{ "id": number, "title": string, "completed": boolean }`

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| GET | /tasks | - | 200 list | - |
| POST | /tasks | `{ title, completed? }` | 201 task | 400 |
| PUT | /tasks/:id | `{ title?, completed? }` (at least one) | 200 task | 400, 404 |
| DELETE | /tasks/:id | - | 204 | 400, 404 |

Errors return `{ "error": "message" }`. Invalid ids (not a positive integer), empty or non-string titles, non-boolean `completed`, and malformed JSON give 400; unknown ids give 404.
