# GateGuard API

Base URL: `/api`. All responses are JSON. Authentication is an `httpOnly`
session cookie (`gg_session`) issued on sign-in; a `Bearer` token in the
`Authorization` header is also accepted for scripting.

Errors share one shape:

```json
{ "error": { "code": "bad_request", "message": "Some fields need attention",
             "details": [{ "field": "email", "message": "Enter a valid email address" }] } }
```

Codes: `bad_request` (400), `unauthorized` (401), `forbidden` (403),
`not_found` (404), `conflict` (409), `rate_limited` (429), `server_error` (500).

## Health

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/health` | none | `{ status, service, version, database, uptimeSeconds, time }` |

## Authentication

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/auth/register` | none | `{ name, email, password }` → organizer account. Rate limited. |
| POST | `/auth/login` | none | `{ email, password }`. Rate limited. |
| POST | `/auth/logout` | none | Clears the session cookie. |
| GET | `/auth/me` | session | Current user. |

Self-service signup always produces an **organizer** that can manage only its
own events. There is no public path to any other role.

## Events

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/events` | organizer / operator | Own events, or the operator's assigned events, each with `stats`. |
| POST | `/events` | organizer | Create. |
| GET | `/events/:id` | event access | Event plus live `stats`. |
| PATCH | `/events/:id` | event owner | Partial update. |
| DELETE | `/events/:id` | event owner | Refuses when attendees are checked in unless `?force=true`. |
| GET | `/events/:id/stats` | event access | Authoritative counts. |
| GET | `/events/:id/analytics` | event access | `?bucket=15` minutes. Timeline, per-gate, outcome breakdown. |
| GET | `/events/:id/scans` | event access | `?limit=50&outcome=duplicate`. |
| GET | `/events/:id/offline-manifest` | event access | Hashed valid codes for offline validation. No attendee data, no signing key. |
| GET | `/events/:id/export/tickets.csv` | event owner | CSV of attendees. |
| GET | `/events/:id/export/scans.csv` | event owner | CSV of every scan attempt. |

## Tickets

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/events/:id/tickets` | event access | `?q=&status=checked_in\|pending\|cancelled&page=&limit=`. |
| POST | `/events/:id/tickets` | event owner | `{ name, email, phone?, collegeId? }` → ticket with `qrPayload`. |
| POST | `/events/:id/tickets/import` | event owner | `{ attendees: [...] }`, up to 2000. Reports skipped rows. |
| GET | `/events/:id/tickets/:ticketId` | event access | One ticket with `qrPayload`. |
| POST | `/events/:id/tickets/:ticketId/reissue` | event owner | New code; the old QR stops working. |
| POST | `/events/:id/tickets/:ticketId/cancel` | event owner | Refused once the attendee is checked in. |

## Check-in

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/events/:id/checkin` | event access | `{ payload, scanId, gate?, entry?, scannedAt? }`. |
| POST | `/events/:id/checkin/batch` | event access | `{ gate, scans: [...] }`, up to 200. Replays a device queue. |

`200` when the ticket is admitted, `409` when it is refused. **A refusal still
carries the full result**, so clients must read the body of a 409:

```json
{ "result": { "ok": false, "outcome": "duplicate", "message": "Already checked in",
              "attendeeName": "Diya Patel",
              "firstCheckIn": { "at": "2026-10-17T13:04:00.000Z", "gate": "Side Gate" } },
  "stats": { "registered": 84, "checkedIn": 51, "remaining": 33, "attendancePct": 60.7 } }
```

Outcomes: `checked_in`, `duplicate`, `conflict`, `invalid_signature`,
`malformed`, `wrong_event`, `unknown`, `cancelled`.

`scanId` makes the call idempotent: submitting the same id again replays the
stored outcome and never produces a second record.

## Public (no session)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/public/events/:id` | Event summary for the registration page. 404 for drafts. |
| POST | `/public/events/:id/register` | `{ name, email, phone?, collegeId? }`. Rate limited. |
| GET | `/public/tickets/:code` | The attendee's own pass. The code is the capability. |

## Operators and audit

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/operators` | organizer | Operators this organizer created. |
| POST | `/operators` | organizer | `{ name, email, password, eventIds }`. Only own events can be assigned. |
| PATCH | `/operators/:id/events` | organizer | Reassign. |
| DELETE | `/operators/:id` | organizer | Remove. |
| GET | `/audit` | organizer | `?limit=&eventId=`. Administrative actions. |
