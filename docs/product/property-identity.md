# Property identity & uniqueness

Canonical key: `project_id` + `district.code|group|building|unit` after normalization
(`normalize_segment`): trim, uppercase, remove spaces/`-_./\`, drop leading zeros in numeric runs
(`"b 01"→"B1"`, `"0012"→"12"`). Only letters and digits are allowed.

Completeness rules (no false assumptions of uniqueness):
- Apartment, duplex, penthouse, studio, twin house: unit **required**.
- Villa, townhouse: identified by house number in `building_code`; unit **must be empty**.
- Missing group/building ⇒ rejected. District must belong to the project.

Database guarantee: `UNIQUE (project_id, identity_key)`; concurrent registrations of the same unit yield exactly
one `201` and `409 property_exists` (with the existing `property_id`) for the rest, which the client turns into
"claim this property". `POST /properties/identity-check` lets the app check first.

Admin `GET /admin/duplicates` surfaces buildings where a unit-less record coexists with unit records (possible
mis-registration) for manual review.

The property record is permanent: claims, listings and deals reference it, so its identity survives ownership
changes (`superseded` claims, `revoked` claims after disputes) and historical transactions. Building and unit are
never in public payloads; they are disclosed to deal parties once terms are agreed.
