# Kunestu: public PL/EN/UK and management PL/EN

Date: 2026-10-16. Branch: feat/kunestu-participant-model-fair-queue. Preserved HEAD: 721a1dd35caec0666d099024a344628c6e075c1c.

## Verdict

| Scope | Verdict | Evidence / limits |
| --- | --- | --- |
| Public session PL | PASS | Local optimized-build P0, independent PL device, request, queue/Realtime, preference and component coverage. |
| Public session EN | PASS | Local optimized-build P0, requests, 2/2 rejection, cancellation dialog cancel path, Presence, queue/Realtime, persistence and EN fallback. |
| Public session UK | PASS | Local optimized-build P0 with PL/EN devices: join, search, requests, duplicate/2/2, Realtime, actual cancellation, device-link dialog, persistence, language changes and mobile/desktop. |
| Dashboard PL/EN | PARTIAL | Complete catalogs and translated implementation; controlled tests plus live read-only organization/queue/participants smoke pass in both languages. Full platform-admin browser journeys and mutation coverage in both languages remain unexecuted. |

PASS is scoped to the documented local Chromium and controlled test evidence. Physical-device and production verification are not implied. The latest public EN fallback requirement is PASS. Overall original i18n task is PARTIAL because broader management browser verification remains. No deployment approval is implied.

## Architecture and decision

next-intl 4.14.9 integrates with the existing Next 16.3 App Router and React 19.2 application. It provides the server/client locale boundary, ICU interpolation/plural rules and locale-aware formatters. It requires no domain, database, proxy or authentication redesign.

No locale route segments or middleware rewrites were introduced. Proxy forwards a display-only management header for the existing protected routes and four standalone entry screens; those four return directly without adding an Auth operation. updateSession and its cookies/redirects/authorization logic remain unchanged. Protected-request forwarding and the new display-only branches are covered by controlled tests. Existing /join, /join/[code], /session/[code], /s/[token] and nested catalog/search addresses, event slugs and QR destinations retain their original meaning. Auth callback routes, API codes, enum values, identifiers, cookies for identity and authorization are unchanged by i18n. Fair Queue mathematics and Enterprise DnD placement logic are outside this change.

src/i18n/request.ts reads the preference cookie and Accept-Language on each request. Public priority: validated kunestu_locale cookie, highest-quality supported browser language (regional variants accepted; equal weights retain header order), then English. Thus pl-PL → pl, uk-UA → uk, en-US → en; unsupported es-ES, ru-RU and ar-SA → en; es-ES,uk-UA;q=0.9,en;q=0.8 → uk. Zero/invalid q values are excluded. No IP, geolocation or nationality is used. Management retains its existing Polish fallback and explicit preferences. Invalid preferences cannot choose an arbitrary catalog import. PL and EN dictionaries use matching keys (1,155 each). Ukrainian has 371 public/shared entries; AST coverage tests check every public route/helper/shared UI alias and all semantic counters. UK is deliberately not merged with an EN fallback in public screens. HTML lang and server metadata use the selected locale before client hydration.

AppIntlProvider supplies NextIntlClientProvider with explicit locale catalogs and the Warsaw time zone. The server chooses the locale before hydration; the client boundary also resolves management scope because root layouts persist across client navigation. useUiText is the synchronous server/client helper; getUiText is used in async server components. Source-index aliases provide stable translation keys while retaining existing pure UI helpers and API-code-to-presentation mappings. Only known UI text is passed through this adapter. Dynamic participant, event, organization, collection, genre and song content remains domain data and is not translated. Interpolated values remain React text, never HTML.

Counts use ICU one/few/many/other for Polish and Ukrainian and one/other for English. Date and number presentation uses the selected locale; event times remain Europe/Warsaw. Datetime-local input conversion, search normalization, artwork hashes and identifiers retain their original contracts.

## Preference and language switch

The existing design system DropdownMenu radio control is used in public navigation, participant entry/lifecycle screens, active session header, standalone sign-in/sign-up/setup/invite screens and dashboard header. Names Polski, English and Українська are autonyms. The correct Ukrainian locale is uk, never ua. Management selectors expose only PL/EN.

The switch writes only kunestu_locale, scoped to /, with a one-year max age, SameSite=Lax and Secure on HTTPS. This non-sensitive preference is deliberately client writable. It does not write identity/session tokens to web storage. router.refresh merges the new RSC result at the same URL; form state, nickname drafts, search and participant identity remain mounted. Each browser/device has its own preference; operators cannot set the event's language for participants. A uk preference resolves to EN in management without rewriting the preference cookie. Client navigation back to public pages restores UK. RootLayout resolves public and management locales independently and provides both catalogs when different. This also preserves EN-public/PL-management defaults for an unsupported browser during client navigation. The selector is visible for automatically selected EN as well.

## P0 public participant coverage

- Code/QR target resolution, join and nickname form, nickname validation and collision errors.
- Catalog discovery, genres, playlists/collections, search, pagination, song details and source labels. Song titles/artists and catalog data retain their supplied names.
- Submitting requests, success/error toasts, duplicate and rate-limit errors, explicit 2/2 rejection and capacity feedback.
- Public queue, current singer, own requests, canonical request status badges, queue position, next-request indicators and cancellation confirmation/cancel.
- Participant profile editing, identity/device-linking and merge consent presentation.
- Presence operation remains unchanged; online labels are localized in operator participant management.
- Invalid, scheduled, closed, cancelled, unavailable, disabled, empty and loading states, ARIA labels, breadcrumbs, drawer controls and notification labels.
- Active-session language switching, individual preference and fallback.

## Dashboard and administration coverage

Dashboard/organization overview, event listing/detail/settings/sharing, participants/history/merging, operator queue/Fair Queue controls and accessibility announcements, account/security, onboarding, organization/team/settings/archive confirmation, platform administration/imports/export/job status, sign-in/sign-up/setup/invite, theme control, skeletons and safe validation/action messages are localized. Authorization and mutation contracts remain server enforced.

## Audit findings and corrections

A TypeScript AST inventory distinguished JSX display text, attributes, UI records, presentation helpers and domain values. Final literal-key audit: no missing referenced literal keys. Remaining literal JSX words are only Poza Nutą, Polski, English and Українська. One unused source alias, Polski, remains from the visual fixture language label; it is not applied to user data. Dynamic JSX was reviewed separately; absence of raw JSX text alone is not treated as proof of complete coverage.

47 initial unused entries, mostly visual fixture artist/song names, and nine superseded count messages were removed. Numeric messages now have explicit ICU keys. Catalog parity, all-message formatting, interpolation slots and locale negotiation are tested. Equal PL/EN text is intentional for brands/technical names; retained Polish diacritics in equal translations belong only to the product brand.

Translation was moved to display boundaries where raw messages participate in logic: an empty search remains a status rather than becoming an error after localization. Request action accessibility labels translate the action separately from singer/song data. Locale changes do not replay an already announced settings success toast. Global console.error was not overridden.

The real mobile P0 scenario exposed a responsive confirmation defect: both mounted queue views opened their cancellation portal for the same shared request ID, hiding the visible dialog from accessibility queries. Only the active presentation now opens it. A component regression failed with two alertdialogs before the correction and passes with one accessible dialog afterwards. Request status transitions and cancellation APIs are unchanged.

## Safe verification boundaries

pnpm test was reviewed: Node tests and mocked/controlled Vitest suites do not run the PostgreSQL/E2E migration-and-seed harness. Negative-target tests may launch entry points but assert rejection before a database socket opens.

The standalone browser smoke is opt-in and is not part of pnpm test or the Playwright fixture runner. It never loads root environment files. It requires an explicitly supplied managed local application PID, the existing synthetic operator fixture, a localhost origin, and blocks browser requests to non-loopback hosts. The app was launched with the existing guarded local-next wrapper against the existing dedicated development stack. No cloud/Vercel/Supabase MCP was used.

Its explicit side effects are new synthetic I18n participants, their own requests and Presence, approval of requests created by that run, and cancellation of its own pending UK request after verifying the cancel path. It does not seed, migrate, reset, delete or edit pre-existing participant/request records. Failed trial runs also left synthetic records locally; none were cleaned by deleting data. No production/shared database was used. Device contexts have separate preferences and simulated network addresses; rate-limit constants are unchanged and the scenario pauses to respect the existing page-render limit.

## Evidence and results

- pnpm test: 413 Node and 673 Vitest PASS, including 70 i18n tests.
- pnpm typecheck: PASS.
- pnpm lint: PASS without warnings after the effect dependency correction.
- pnpm build: PASS; optimized production compilation, TypeScript, page generation and route inventory completed.
- git diff --check: PASS; repeated after documentation completion.
- Local Chromium optimized-build P0 smoke: 22 checks PASS. Three independent PL/EN/UK contexts share the same synthetic local event. Real local API requests, 2/2 and duplicate rejection, Presence and Realtime invalidation/refetch were verified. UK cancellation was performed only for that run's pending request after first testing the cancel path. Zero page/runtime errors, zero external requests and no unexpected console errors. Exactly five expected HTTP 409/500 resource errors came from the explicit negative cases; they were asserted, not suppressed. Main mobile cases emulate a 390 px viewport, not physical hardware.
- Local optimized-build negotiation/persistence browser smoke: 12 checks PASS. Exact Accept-Language headers cover every requested example, weight ordering and stable equal weights. The EN fallback exposes all three autonyms; manual PL and UK survive reload; management remains PL for an unmatched browser and client navigation restores public EN. Zero runtime errors or blocked requests. All non-GET/HEAD and non-loopback requests were forbidden by this read-only test.
- Latest optimized-build UK negative/touch smoke: four checks PASS (invalid QR/code target, invalid canonical session, nickname validation before any join mutation, UK/EN switching retaining Cyrillic draft). Zero runtime errors, external requests or join mutations. Touch is Chromium iPhone 13 emulation only.
- Earlier development read-only browser smoke: nine checks passed, zero page errors and zero blocked external requests. It covered browser EN negotiation, PL/EN switching, reload persistence, signup, join, public mobile events, synthetic operator dashboard/queue/participants and unchanged session-code URL.
- Repeated on the latest optimized build and extended to PL management: 12 checks PASS, zero runtime errors/external requests. Includes organization dashboard, operator queue and participants in both PL and EN. No queue/participant mutation was performed by this separate smoke. Evidence: .artifacts/i18n-management-current-result.json.

Artifacts: .artifacts/i18n-three-final-{test,typecheck,lint,build,diff-check}.log, i18n-final-source-audit.json, i18n-orphan-review.json, i18n-browser-result.json, i18n-en-fallback-browser-result.json, i18n-public-negative-result.json, i18n-p0-browser-result.json and mobile/desktop screenshots. The dialog diagnostic/regression logs preserve the before/after evidence. Intermediate logs remain available and are not final PASS evidence.

Intermediate browser attempts first exposed the duplicate cancellation dialog and then a strict selector matching both responsive queue copies. Those failures are preserved in i18n-p0-before-dialog-fix.json and i18n-p0-before-visible-selector-fix.json. The selector now asserts the visible UK singer row, as already done in EN; the final 22-check run passed. Screenshots are supplementary snapshots (some capture loading/animation), not substitutes for the interaction assertions.

## What is not verified

Physical phone/tablet, camera QR scanning, Safari/iOS and VoiceOver/TalkBack have not been exercised. Chromium mobile is viewport emulation, not a physical-device PASS. No cloud, Preview or production runtime, production schema compatibility, production Auth email flow, production DB write or new PostgreSQL concurrency/fault suite was executed for this UI-only slice. Those suites use migration/fixture setup and were intentionally not resumed. Unavailable/closed states are covered by component tests without closing the existing event; synthetic network failure is distinguished from a real backend outage.

Physical-device checklist (NOT EXECUTED):

- Scan the existing QR using PL/UK devices, then EN/UK devices, and join the same approved isolated event independently.
- Search/request/cancel a song and observe the queue update without reloading; check 2/2, duplicate and offline/reconnect feedback.
- Switch Polski → Українська → English → Polski while editing a nickname/search; verify the draft, identity and requests remain intact.
- Refresh/reopen and verify the manual preference; start a clean unsupported-language browser and check the EN fallback with a visible three-language selector.
- Check touch scrolling, portrait/landscape, keyboard overlap and long Cyrillic/English labels; no horizontal overflow.
- Use VoiceOver/TalkBack to check page language, translated actions, cancellation confirmation focus and return focus after cancelling.

These are manual tasks, not physical-device PASS evidence. Run only in an explicitly approved isolated environment.

## Ukrainian scope and next stage

UK covers public discovery/events and the complete participant path, including identity/linking/merge consent, request/queue states, limits, errors, accessibility, notifications, counts and Warsaw date presentation. Arbitrary domain data (including names written in Polish or another alphabet) is never translated automatically. The uk-UA browser language is normalized to uk; an explicit preference wins.

The next separate stage for management UK is to translate the remaining dashboard/admin catalog, require full key parity and human language review, then remove the management fallback and enable UK in management selectors. Add desktop/mobile management regressions and maintain the existing authorization tests. No schema migration is required for that stage; it is not implemented here.

## Extension and maintenance

To add a language, extend the supported locale list/type, supply the required catalog keys for its supported scope, add its autonym to the selector and extend parity/negotiation/plural tests. Do not add route prefixes. Add UI text via stable message aliases or semantic ICU messages; keep codes/parameters separate from domain content. Unknown legacy UI aliases fall back to their source text, so new display/error paths must be added to both catalogs and tests. During development, restart the local server after broad catalog regeneration before evaluating missing-message diagnostics; final verification uses a fresh optimized build.

## Preserved unrelated work

Participant/Fair Queue checkpoint, Enterprise DnD, benchmark artifacts/reports and all prior uncommitted changes remain. .codex/config.toml is untouched by this task (SHA-256 verified against the starting value). Infrastructure isolation was explicitly stopped; the unfinished lint/build/isolation verdict from that stage remains recorded in local-development-isolation.md. This i18n verification is not closure of that separate infrastructure task. No commit, push, deployment, migration or rebranding was performed.

## i18n files changed

Other modified/untracked files predate this slice and are deliberately not claimed as i18n changes.

- `next.config.ts`
- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `src/app/(platform-admin)/admin/layout.tsx`
- `src/app/(public)/events/[slug]/error.tsx`
- `src/app/(public)/events/[slug]/loading.tsx`
- `src/app/(public)/events/[slug]/not-found.tsx`
- `src/app/(public)/events/[slug]/page.tsx`
- `src/app/(public)/events/page.tsx`
- `src/app/(public)/page.tsx`
- `src/app/account/page.tsx`
- `src/app/account/security/page.tsx`
- `src/app/auth/invite/accept/page.tsx`
- `src/app/dashboard/new/page.tsx`
- `src/app/dashboard/onboarding/profile/page.tsx`
- `src/app/dashboard/org/[organizationId]/events/[eventId]/page.tsx`
- `src/app/dashboard/org/[organizationId]/events/[eventId]/participants/loading.tsx`
- `src/app/dashboard/org/[organizationId]/events/[eventId]/participants/page.tsx`
- `src/app/dashboard/org/[organizationId]/events/[eventId]/queue/page.tsx`
- `src/app/dashboard/org/[organizationId]/events/[eventId]/settings/page.tsx`
- `src/app/dashboard/org/[organizationId]/events/[eventId]/share/page.tsx`
- `src/app/dashboard/org/[organizationId]/events/new/page.tsx`
- `src/app/dashboard/org/[organizationId]/events/page.tsx`
- `src/app/dashboard/org/[organizationId]/page.tsx`
- `src/app/dashboard/org/[organizationId]/settings/page.tsx`
- `src/app/dashboard/org/[organizationId]/team/page.tsx`
- `src/app/dashboard/organizations/page.tsx`
- `src/app/dashboard/page.tsx`
- `src/app/dashboard/queue/page.tsx`
- `src/app/join/page.tsx`
- `src/app/layout.tsx`
- `src/app/s/[token]/layout.tsx`
- `src/app/setup/page.tsx`
- `src/app/sign-in/page.tsx`
- `src/app/sign-up/page.tsx`
- `src/components/app-shell/app-shell.tsx`
- `src/components/app-shell/app-sidebar-user.tsx`
- `src/components/app-shell/app-sidebar.tsx`
- `src/components/app-shell/sidebar-navigation.tsx`
- `src/components/app-shell/site-header.tsx`
- `src/components/language-switcher.tsx`
- `src/components/operator/archive-organization-form.tsx`
- `src/components/operator/close-event-confirmation.tsx`
- `src/components/operator/create-event-form.tsx`
- `src/components/operator/dashboard-organization-switcher.tsx`
- `src/components/operator/dashboard-runtime-error.tsx`
- `src/components/operator/dashboard-shell.tsx`
- `src/components/operator/dashboard-skeletons.tsx`
- `src/components/operator/event-management-panel.tsx`
- `src/components/operator/event-overview.tsx`
- `src/components/operator/event-participants-panel.tsx`
- `src/components/operator/event-queue-panel.tsx`
- `src/components/operator/event-session-access-panel.tsx`
- `src/components/operator/event-workspace-header.tsx`
- `src/components/operator/fair-queue-control.tsx`
- `src/components/operator/general-join-access-panel.tsx`
- `src/components/operator/login-form.tsx`
- `src/components/operator/operator-profile-onboarding-form.tsx`
- `src/components/operator/organization-overview-view.tsx`
- `src/components/operator/organizer-sidebar.tsx`
- `src/components/operator/participant-merge-panel.tsx`
- `src/components/operator/queue-drag-board.tsx`
- `src/components/operator/setup-forms.tsx`
- `src/components/operator/signup-form.tsx`
- `src/components/operator/unauthorized-sign-in.tsx`
- `src/components/participant-merge-preview.tsx`
- `src/components/platform-admin/admin-access-denied.tsx`
- `src/components/platform-admin/admin-error-state.tsx`
- `src/components/platform-admin/admin-imports-panel.tsx`
- `src/components/platform-admin/admin-imports-skeleton.tsx`
- `src/components/platform-admin/admin-overview-skeleton.tsx`
- `src/components/platform-admin/admin-overview.tsx`
- `src/components/platform-admin/admin-shell.tsx`
- `src/components/platform-admin/admin-sidebar.tsx`
- `src/components/public/catalog-song-list.tsx`
- `src/components/public/current-queue-song-bar.tsx`
- `src/components/public/discovery-home-page.tsx`
- `src/components/public/event-card.tsx`
- `src/components/public/event-carousel.tsx`
- `src/components/public/event-search-form.tsx`
- `src/components/public/join-code-gate.tsx`
- `src/components/public/participant-identity-dialog.tsx`
- `src/components/public/participant-join-gate.tsx`
- `src/components/public/participant-profile-drawer.tsx`
- `src/components/public/public-request-page.tsx`
- `src/components/public/public-session-entry-shell.tsx`
- `src/components/public/public-session-lifecycle.tsx`
- `src/components/public/public-site-header.tsx`
- `src/components/public/session-catalog-collections.tsx`
- `src/components/public/session-catalog-genres.tsx`
- `src/components/public/session-code-form.tsx`
- `src/components/public/session-discovery-home.tsx`
- `src/components/public/session-participant-requests.tsx`
- `src/components/public/session-queue-list.tsx`
- `src/components/public/session-queue-panel.tsx`
- `src/components/public/session-request-page.tsx`
- `src/components/public/session-search-results.tsx`
- `src/components/public/session-shell-header.tsx`
- `src/components/public/session-song-artwork.tsx`
- `src/components/public/session-song-row.tsx`
- `src/components/public/session-state-alert.tsx`
- `src/components/public/song-details-drawer.tsx`
- `src/components/request-status-badge.tsx`
- `src/components/theme-switcher.tsx`
- `src/components/ui/breadcrumb.tsx`
- `src/components/ui/carousel.tsx`
- `src/components/ui/dialog.tsx`
- `src/components/ui/sheet.tsx`
- `src/components/ui/sidebar.tsx`
- `src/components/ui/sonner.tsx`
- `src/i18n/locale.ts`
- `src/i18n/messages/en.json`
- `src/i18n/messages/pl.json`
- `src/i18n/request.ts`
- `src/i18n/server.ts`
- `src/i18n/source-index.json`
- `src/i18n/text.ts`
- `src/i18n/use-ui-text.ts`
- `tests/dashboardOrganizationRouting.test.ts`
- `tests/e2e/internationalization.local-smoke.mjs`
- `tests/e2e/internationalization-locale.local-smoke.mjs`
- `tests/eventQueueManagement.test.ts`
- `tests/interactionFeedback.test.ts`
- `tests/publicEvents.test.ts`
- `tests/vitest/admin-shell.component.test.tsx`
- `tests/vitest/admin-theme-switcher.component.test.tsx`
- `tests/vitest/app-shell-navigation.component.test.tsx`
- `tests/vitest/internationalization.component.test.tsx`
- `tests/vitest/internationalization.test.ts`
- `tests/vitest/session-shell-header.component.test.tsx`
- `tests/vitest/setup.ts`
- `src/proxy.ts`
- `src/i18n/app-intl-provider.tsx`
- `src/i18n/messages/uk.json`
- `tests/vitest/internationalization-public-coverage.test.ts`
