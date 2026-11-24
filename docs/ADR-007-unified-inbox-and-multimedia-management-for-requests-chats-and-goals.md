# ADR-007: Unified Inbox and Multimedia Management for Requests, Chats, and Goals
Date: 2026-05-11
Status: Proposed

## Context
The current system manages requests using three main tables: `solicitudes`, `solicitudes_bitacora`, and `solicitudes_archivo`. We need to introduce new interactive item types ("chats" and "objetivos") that must coexist in the same inbox as regular activities.

Functional requirements for this evolution:

- Single inbox: All activity types must be listed together efficiently.
- Variable lifecycle: Chats do not expire and their states are not final, unlike regular activities.
- Flexible attachments: Files must be attachable at creation time and in any later update or message.

Identified problem: The initial proposal of adding a foreign key field (`archivo_id`) directly to `solicitudes_bitacora` limits the system to a single file per message or observation. This is a functional bottleneck because multiple attachments (for example, several images) are commonly required in a single chat interaction or state update.

## Decision
We will implement Single Table Inheritance (STI) on the main entity and normalize file handling by adding a pivot table for the log.

Specific architectural actions:

- Discriminator field: Keep `solicitudes` as the parent table (single inbox), using the `tipo_actividad` field (e.g., `actividad`, `chat`, `objetivo`) to distinguish record types.
- Flexible date schema: Allow `fecha_inicio` and `fecha_fin` in `solicitudes` to be `NULL` to support non-expiring chats.
- Expiration logic (cron): Update the expiration job to explicitly exclude records where `tipo_actividad = 'chat'`.
- New pivot table (`bitacora_archivo`): Create a relational table that links `solicitudes_bitacora.id` to `archivo_id`. This enables a one-to-many (1:N) relationship, allowing multiple attachments per interaction.
- Dual file linking (global repository): Each file uploaded in a message will be recorded in `bitacora_archivo` (message context) and inserted into `solicitudes_archivo` (global gallery for the parent request).

## Consequences
### Positive
- Multimedia scalability: Users can attach an unlimited number of files in a single chat message or log update without future schema changes.
- Inbox read efficiency: Centralizing all items in a single parent table (`solicitudes`) makes inbox queries fast and simple (a single `SELECT` filtered by `deleted_at IS NULL`).
- Integrity and cleanliness: `solicitudes_bitacora` remains lightweight, focusing on transactional metadata (text, states, dates).

### Negative / Risks
- Insertion complexity (backend): Sending a message with files requires multiple inserts in a single transaction (bitacora, pivot rows in `bitacora_archivo`, and rows in `solicitudes_archivo`).
- Controlled logical redundancy: Files are referenced at the micro level (specific message) and at the macro level (overall request).

## Alternatives Considered
- Add `archivo_id` to `solicitudes_bitacora`: Rejected. It enforces a 1:1 relationship between a message and a file. It would require creating multiple log entries with the same text when the user wants to send several photos, polluting the history.
- Create separate parent tables (e.g., `chats`, `objetivos`): Rejected. It breaks the single inbox requirement, forcing complex `UNION` queries and duplicated history/log logic for each entity.
