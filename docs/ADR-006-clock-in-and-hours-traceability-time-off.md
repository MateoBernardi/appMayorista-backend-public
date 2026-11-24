# ADR-006: Clock-In Mechanism and Hours Traceability (Time Off)
Date: 2026-04-17
Status: Accepted
Scope: Backend, Database, Mobile/Web Client

## 1. Context and Problem
The system is required to implement on-site attendance control (clock-in/clock-out) for employees, together with a mechanism to calculate excess/missing hours against a 48-hour weekly schedule. Accumulated hours will be used for time-off eligibility.

Identified problems:

- Location validation: The initial proposal to validate physical presence using the device network IP was highly fragile. Commercial ISP IP addresses are often dynamic, and multiple network exits or mobile data usage would invalidate legitimate check-ins.
- Balance traceability: Using a single table (`horas_semanales`) that mutates one scalar field with the "current balance" is risky. In case of discrepancies or errors, there is no auditable history showing how that balance was reached.

Note: Vacation logic is out of scope for this document.

## 2. Architectural Decisions
### Decision 2.1: Presence validation via Geofencing + QR
IP-based validation is discarded. The system will use mobile GPS location combined with QR code scanning.

The flow requires the client to send coordinates (latitude, longitude) together with a QR identifier to the backend. The backend is the source of truth and computes distance between the user and office coordinates.

### Decision 2.2: Traceability via Ledger pattern (running account)
Single-field balance mutation is discarded. An append-only table (`saldos_francos`) will be implemented.

Current balance will be computed dynamically or materialized in a view by summing these records.

## 3. Standard Libraries and Recommended Tools
To implement the Haversine formula (spherical distance calculation), date handling, and QR-related workflow efficiently, the following options are established depending on stack:

### Geofencing calculation (DB)
- POSTgis

### Scheduling and CRON (weekly close)
- Node.js:
  - `node-cron` to run the 48-hour calculation every Sunday.
  - `date-fns` or `Day.js` for date/time arithmetic (e.g., `horario_out - horario_in`).

## 4. Consequences
### Positive (Benefits)
- High geographic reliability: The DB mathematically guarantees employee proximity to the building, independent of network type (Wi-Fi, 4G, 5G).
- Full auditability: HR or administrators can see exactly where an employee's time-off balance came from. The Ledger pattern prevents data loss and simplifies bug detection.
- Decoupling: Heavy validation and business logic remain fully in the backend, enabling a "thin" client that only handles permissions and camera scanning.

### Negative (Trade-offs to consider)
- UX friction: The user must grant location permissions to the web/mobile app on first use.
- GPS edge cases: In buildings with heavy interference, GPS can bounce and produce higher error margins.
- Mitigation: Define an initially generous tolerance radius (e.g., 100-150 meters), configurable via environment variable.
- Database growth: The `movimientos_francos` table will grow with each weekly close; in relational database terms, expected volume impact is negligible.
