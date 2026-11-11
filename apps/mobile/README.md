# Darna mobile (Expo)

Owner-direct real-estate app for Madinaty (New Cairo): buyers/tenants browse, compare, chat, book
viewings and negotiate; owners verify identity, register and claim properties, list, and run deals.
Bilingual English / Arabic with full RTL, light and dark themes.

> **No installable package (APK/AAB/IPA) has been produced.** Only JS bundles were built
> (`expo export` for web and Android). See *Building installable apps* below.

## Stack

Expo SDK 58 · Expo Router (file-based routes in `app/`) · React Native 0.88 · TypeScript 5.9 ·
TanStack Query · i18next/react-i18next + expo-localization · expo-secure-store (tokens; `localStorage`
fallback on web) · expo-image / expo-image-picker / expo-document-picker.

Shared workspace packages: `@darna/api-client` (typed OpenAPI client — all API calls go through it) and
`@darna/design-tokens` (palette, light/dark schemes, spacing, `formatEGP`). Metro resolves them through
npm workspaces (Expo's default config handles the monorepo; see `metro.config.js`).

## Run

From the repo root, install once: `npm install`. The API must be running (default `http://localhost:8000`).

```bash
cd apps/mobile
npm run web            # Expo dev server + browser (http://localhost:8081, allowed by the API's CORS)
npm start              # Expo dev server; scan the QR code with Expo Go (SDK 58) on a phone
npm run android        # Android emulator (needs Android SDK) — API defaults to http://10.0.2.2:8000
npm run ios            # iOS simulator (macOS + Xcode)
```

### Environment

| Variable | Default | Notes |
| --- | --- | --- |
| `EXPO_PUBLIC_API_URL` | `http://localhost:8000` | On the Android emulator the default becomes `http://10.0.2.2:8000`. On a physical device use your machine's LAN IP, e.g. `http://192.168.1.20:8000`. |
| `EXPO_PUBLIC_EAS_PROJECT_ID` | unset | EAS project id used for Expo push tokens (also exposed as `extra.eas.projectId`). Unset → push registration is skipped and settings shows "Push not configured in this build". |

The API returns absolute media URLs (`http://localhost:8000/media/...`); `src/config.ts#mediaUrl`
rewrites that origin to `EXPO_PUBLIC_API_URL` so images load on emulators/devices.

Demo accounts (password `Demo-pass-2026`): `buyer@example.com`, `tenant@example.com`,
`owner@example.com`, `newowner@example.com`.

## Push notifications

`src/notifications/` — `push.ts` (pure, tested: token format check, data → route mapping, status model),
`device.ts` (permission, Expo push token, `POST/DELETE /notifications/devices`) and `PushProvider`
(registration after sign-in, deep links on tap).

* After sign-in on a **physical** iOS/Android device the app asks for permission **once** (never re-prompts
  after a denial; settings offers "Open phone settings" instead), gets the Expo push token and registers
  it. Web, simulators and emulators register nothing; settings shows why.
* Sign-out unregisters the token (`DELETE /notifications/devices?token=…`) **before** auth is cleared.
* Taps deep-link by `data`: `conversation_id` → chat, `deal_id` → deal workspace, `viewing_id` → viewings,
  `listing_id` → owner listing (for `listing_*` events) or the public listing, `property_id`/verification →
  owner hub, `case_id` → support. Only id-shaped values are accepted.
* **Notification settings** (Profile → Notification settings, or Settings) toggle the API's per-category
  push preferences (`GET/PUT /notifications/preferences`) optimistically, rolling back a failed toggle.

Real delivery is **not verified here** and needs:

1. An EAS project: `npx eas-cli init`, then set `EXPO_PUBLIC_EAS_PROJECT_ID` (or `extra.eas.projectId`).
2. Credentials: Android — an FCM v1 service-account key uploaded with `npx eas-cli credentials`
   (plus `google-services.json` / `android.googleServicesFile` in the app config); iOS — an APNs key
   (Apple Developer account), managed by EAS credentials.
3. A development or production build (`eas build`) on a physical device. Expo Go is not suitable for
   push on Android since SDK 53.
4. The API with `DARNA_PUSH_PROVIDER=expo` (default `log` only logs) and optionally
   `DARNA_EXPO_ACCESS_TOKEN` if "enhanced push security" is enabled on the Expo account.

## Dates

All date inputs use `DateField` (`src/components/DateField.tsx` native, `DateField.web.tsx` web). Values
stay ISO `YYYY-MM-DD` strings. Native uses `@react-native-community/datetimepicker` (Android dialog, iOS
inline calendar in a sheet); web overlays a transparent `<input type="date">` on the localized display,
so Playwright can `fill('YYYY-MM-DD')` on the `testID`. Supports `min`/`max` (handover, lease start and
authority expiry cannot be in the past), localized display (Arabic-Indic digits), RTL, a clear button for
optional fields and range messages. Pure helpers live in `src/lib/date.ts`.

## Quality checks

```bash
npx tsc --noEmit                       # typecheck
npx jest                               # unit tests (jest-expo + @testing-library/react-native)
npx expo export --platform web         # production web bundle in ./dist
npx expo export --platform android     # Hermes bundle (JS only, not an APK)
```

Tests (`src/__tests__`): `ListingCard`, `PriceBreakdown` (provenance per line, "Not yet confirmed"
items, estimate assumptions, warnings, rent), i18n/RTL helpers (Arabic-Indic digits, Arabic plurals,
direction + native `forceRTL`, key parity en/ar) and the token refresh logic (refresh once + retry,
single-flight refresh for concurrent 401s, sign-out on refused refresh, no refresh for `/auth/*`),
push helpers (token format, project id, data → route incl. hostile data) and DateField (ISO parsing/formatting,
Arabic digits, min/max, validation messages, clear button).

## Structure

```
app/                      routes (Expo Router)
  (tabs)/                 Explore · Saved · Inbox (messages + viewings) · Deals · Profile
  listing/[id]            gallery, specs, cost breakdown, present-value scenario, actions
  filters, compare        search filters (modal), 2–4 listing comparison
  contact/, conversation/ start a conversation, chat thread (polls every 4 s)
  viewing/, viewings      request a viewing (2 h–60 days, sent as UTC ISO), viewing actions
  offer/, deal/[id]       offers (Idempotency-Key), deal workspace
  owner/                  hub, identity verification, register/claim property, listing create/edit/manage
  notifications, settings, notification-settings, support, welcome, login, register
src/api                   client wiring (auth + refresh middleware), query hooks, error localization
src/auth                  session/refresh logic (pure, tested) and AuthProvider
src/components            Button, TextField, Chips/Select/Segmented, Card, Badge, Notice, ListingCard,
                          PriceBreakdown, Stepper, DateTimeSlots, DateField, DocumentUploader, Empty/Error/Loading states, Screen
src/notifications         push registration (device.ts), PushProvider (deep links), pure helpers (push.ts)
src/features              OfferForm, ListingForm (sale/rent terms, installments, fees), ClaimForm, ViewingsList
src/i18n                  en/ar resources, formatting, direction helpers, LanguageProvider
```

## Product rules enforced in the UI

* Registration requires the "I am not a broker or agent" attestation (`attest_not_broker`).
* Verification badges come only from API flags (`owner_verified`, `financials_verified`). Every
  financial line shows its `provenance`; unconfirmed items read "Not yet confirmed" and are not totalled;
  estimates show their assumption; API warnings render as notices. "Featured" is labelled "Featured · promoted".
* Owner forms offer only *seller provided / estimate (+assumption) / unknown*; never "verified".
* Building/unit appear only in the deal workspace's `property_disclosure`.
* The deal workspace always shows the API's `legal_notice` verbatim (plus an Arabic translation in Arabic).
* Deal actions come from `next_steps` (`who`, confirmations, `blocking_items`) and `can_cancel`; listing
  actions from `allowed_transitions`. The stepper only *displays* the sale vs rent milestone order.

## RTL

Switching to Arabic persists the choice, sets `<html dir="rtl" lang="ar">` on web, and on native calls
`I18nManager.forceRTL` and reloads the JS bundle (`reloadAppAsync`) because React Native fixes layout
direction at startup. Styles use logical `start`/`end`, directional icons are mirrored, and numbers,
money and dates use `ar-EG` (Arabic-Indic digits).

## Building installable apps (not done here — no credentials exist)

`eas.json` defines `development`, `preview` and `production` profiles. Set real
`EXPO_PUBLIC_API_URL` values (the ones in `eas.json` are placeholders; production must be HTTPS).

**Android**

```bash
npx eas-cli login
npx eas-cli build -p android --profile preview      # APK for internal testing
npx eas-cli build -p android --profile production   # AAB for Google Play
# or locally (Android SDK + JDK 17):
npx expo prebuild -p android && cd android && ./gradlew assembleRelease
```

A local release build needs a signing keystore configured in `android/app/build.gradle` (EAS can
generate and store one). `com.darna.app` is a placeholder application id.

**iOS** requires an Apple Developer Program account, a registered App ID matching the bundle id
(`com.darna.app` is a placeholder), and a distribution certificate + provisioning profile. EAS can
create and manage these: `npx eas-cli build -p ios --profile production` (or `--profile development`
for a simulator build), then `npx eas-cli submit -p ios` for TestFlight/App Store.
