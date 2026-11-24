# ADR-001: Push Notifications Workflow — Expo + Firebase Admin with Unified Device Registration
Date: 2026-04-01
Status: Accepted
Deciders: Mateo Bernardi

## Context
The backend needs to send push notifications to native applications (iOS/Android) and web clients (PWA/browser) using the same business workflow.

Notification-triggering events occur across multiple system modules (leave requests, files, folders, requests/activities, reports, announcements, surveys, kanban, association), so the system requires:

- Centralized device registration per user context.
- Platform-based split to choose the proper delivery provider.
- Traceability for sends and errors.
- Deferred receipt verification for Expo.
- Explicit timeouts and controlled degradation to avoid blocking business requests.

Additionally, the system must allow reassigning the same physical device when the user session/profile changes, and support deactivation on logout.

## Decision
We adopt a push delivery architecture with:

1. Unified registration in the devices table (platforms: ios, android, web).
2. A single domain service (devicesService) for validation, normalization, and dispatch.
3. Dual delivery providers:
- Expo Push Notifications for iOS/Android.
- Firebase Cloud Messaging (via firebase-admin) for Web.
4. Persistent logging in notification_logs for status, ticket/receipt, and errors.
5. Cron jobs for inactive-device cleanup and periodic Expo receipt checks.

This decision prioritizes a uniform backend API for all business controllers, isolating provider-specific differences inside the communications adapter.

## Tools
- Node.js + TypeScript.
- Express.
- PostgreSQL (devices and notification_logs tables).
- node-cron.
- Expo Server SDK.
- Firebase Admin SDK.

## Libraries In Use
Main dependencies used by the push workflow:

- expo-server-sdk
- firebase-admin
- node-cron
- pg
- express

## APIs Used
External/provider APIs:

- Expo Push API via SDK:
- sendPushNotificationsAsync(messages)
- getPushNotificationReceiptsAsync(receiptIds)
- chunkPushNotifications(messages)
- chunkPushNotificationReceiptIds(ids)

- Firebase Cloud Messaging (FCM) via firebase-admin:
- admin.messaging().sendEachForMulticast(multicastMessage)

Internal/backend APIs:

- POST /devices
- Registers or updates a user device token.
- auth(allRoles) required.

- POST /auth/logout (complementary flow)
- If pushToken is provided, the associated device is deactivated.

## Controllers: from Registry to Sending
### Device registration and lifecycle
- devicesRoutes -> POST /devices -> registerDeviceController
- registerDeviceController -> registerDevice (devicesService)
- registerDevice -> devicesRepo (find/create/reassign/update)

### Sending from business controllers
Controllers that trigger sending through devicesService:

- archivosControllers
- carpetasControllers
- encuestasControllers
- kanbanControllers
- licenciasControllers
- novedadesController
- reportesControllers
- solicitudesActividadesControllers

Shared service used by all:

- sendNotificationToUser(userContextId, payload)
- sendNotificationToMultipleUsers(userContextIds, payload)

Sending pipeline:

- Business controller -> devicesService (normalizes payload/cache hints) -> expoPushNotifications adapter -> split by platform -> Expo or FCM -> saveNotificationLog.

### Related automated processes
- initNotificationReceiptsCron: checks Expo receipts every 15 minutes.
- initDevicesCleanupCron: removes inactive devices (default: 30 days).

## Payloads
## Common domain payload
Service input interface:

```ts
{
  title?: string;
  body: string;
  data?: Record<string, any>;
  link?: string;
  sound?: 'default' | null;
  badge?: number;
  channelId?: string;
  priority?: 'default' | 'normal' | 'high';
}
```

Applied rule:

- If a top-level link or data.link exists, it is unified and replicated in data.link.
- Cache/invalidity metadata is completed:
- data.domain
- data.event
- data.updated_at
- data.entity_id (when inferable)

## Native payload (iOS/Android via Expo)
Output built per Expo device:

```ts
{
  to: 'ExponentPushToken[...] | ExpoPushToken[...]',
  title,
  body,
  sound,
  badge,
  channelId,
  priority,
  data: {
    ...payload.data,
    link
  }
}
```

Notes:

- Messages are sent in chunks using the Expo SDK.
- Each ticket is logged in notification_logs (status sent/error, expo_ticket_id).

## Web payload (FCM via firebase-admin)
Multicast batch output (up to 500 tokens):

```ts
{
  tokens: ['fcmToken1', 'fcmToken2', '...'],
  notification: {
    title,
    body
  },
  data: {
    // always stringified for FCM
    key: 'value-json-or-string'
  },
  webpush: {
    fcmOptions: {
      link
    }
  }
}
```

Notes:

- data is transformed into Record<string, string>.
- FCM messageId is stored in expo_ticket_id (shared log field).

## Error Handling and Timeouts
## Timeouts
A uniform timeout of 10000 ms is defined for critical external operations:

- Expo send.
- Expo receipts.
- FCM send.
- Device loading in multi-user sending (DB).

Mechanism:

- withTimeout(Promise.race) rejects with a Timeout error when the threshold is exceeded.

## Error handling
- In the registration controller:
- Required field validation (400).
- Missing authenticated userContextId (401).
- Domain/persistence error -> handleError.

- In Expo/FCM sending:
- Errors are captured per chunk/batch to avoid aborting the entire process.
- errors[] is aggregated for the final result.
- notification_logs entries are persisted with error status and details.

- In Expo receipts:
- status ok -> delivered.
- status error -> error_message and error status.

- In logout:
- Failure while deactivating pushToken does not block session termination.

## Pros
- Single domain API for notifications, reusable across all modules.
- Multi-platform support (native + web) with a single payload contract.
- Platform-based token validation reduces operational noise.
- Device-token reassignment supports user switching on the same physical device.
- Delivery and error traceability in the database.
- Explicit timeouts prevent hung requests due to external providers.
- Expo receipts are decoupled via cron, improving delivery observability.

## Cons
- Coupling to two providers (Expo + Firebase) increases operational complexity.
- The log model uses expo_* names for FCM as well (semantically imperfect).
- Error handling prioritizes resilience over fail-fast; some failures remain partial.
- Runtime dependency on service_key.json for Firebase Admin.
- Inactive-device cleanup is time-window based, not based on hard provider invalidation feedback.

## Alternatives Considered
| Alternative | Reason Rejected |
|---|---|
| Expo only for all platforms | Web push requires an FCM/browser stack; it does not robustly cover PWA use cases. |
| FCM only for mobile and web | It would require rewriting the existing mobile flow already integrated with Expo tokens and receipts. |
| Intermediate broker provider (SNS/OneSignal/etc.) | Higher cost and additional external dependency for current scope. |
| Sending without log persistence | Auditability, supportability, and delivery diagnostics would be lost. |

## Consequences
### Positive
- The backend standardizes how notifications are triggered from distinct functional modules.
- Platform separation remains encapsulated and does not pollute business logic.
- The team can audit delivery status and historical errors.

### Negative
- Credentials and compatibility for two SDKs must be maintained.
- The log data model may require refactoring to better distinguish Expo vs FCM.
- Higher maintenance load for cron jobs and monitoring.

### Constraints Introduced
- platform must be one of ios/android/web.
- Web and Expo tokens must satisfy different format validations.
- Data payload for web must be serialized to string.
- Send/receipt operations must complete within 10s or be treated as timeout.
