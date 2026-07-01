# Changelog

## 2026-07-01
- Added a client build badge to the meeting creation sheet header so users and support can visually identify which client build/commit is running in the browser.
- Moved the `meetings` `uploaded` transition from upload initialization to successful multipart completion so server state now matches the real upload lifecycle.
- Fixed the meetings list and detail status badges so a pending multipart upload no longer looks like a healthy finished record; the UI now shows a dedicated "Загрузка подтверждается" state until S3 completion is confirmed.
- Added a web build-id endpoint and a client-side deployment guard so old browser tabs can detect a fresh deploy and prompt the user to reload instead of continuing with stale cached UI.
- Fixed the upload progress rendering so the percentage no longer appears twice in meetings and LMS upload panels.

## 2026-06-30
- Fixed `meetings` multipart upload signing for S3-compatible storage: query-signed `POST` requests now use `UNSIGNED-PAYLOAD` and include forwarded headers in the canonical SigV4 request, removing the `SignatureDoesNotMatch` failure that blocked meeting creation right after the draft record was created.

## 2026-06-02
- Added meeting processing timing metrics and size-based ETA forecasting: completed meetings now expose actual end-to-end processing time, active runs show an estimate derived from nearby historical files, and meeting-start notifications include the expected processing window.
- Recovered a stuck `meetings` upload where the file had already landed in S3 but the upload session never reached `complete`; backend now reconciles such sessions on meeting open/start and auto-enqueues `audio_prepared` when the file is present and `meeting_jobs` are still empty.
- Fixed misleading `meetings` progress UI: `uploaded` records without confirmed pipeline start no longer look like an active 15% processing job and instead show a waiting-for-confirmation state.
- Replaced the top-right user badge with an avatar trigger menu; `Prompts` and `Logout` now live inside the dropdown across LMS, meetings, and prompt editor headers.
- Replaced `Link`-based logout actions with plain anchor navigation so App Router prefetch cannot trigger `/api/auth/logout` in the background and drop the session on refresh.
- Forced full-page navigation from LMS dashboard to `/meetings` and disabled prefetch for that entrypoint to avoid stale auth-sensitive App Router cache sending users back to the start screen.
- Fixed LMS course selection in the left panel after auth rollout: cards now show pointer affordance, highlight by active selection immediately, avoid nested interactive markup, and retry detail loading when the selected course has an empty right pane.
- Added explicit links from `EcoLMS` docs to the shared `EcoAuth` authorization and `Logto` reference documents.

## 2026-06-01
- Fixed `meetings` page SSR data loading to call the internal API directly with trusted auth headers, avoiding session loss on navigation from the main LMS screen.
- Added EcoAuth/Logto authentication to `EcoLMS` using a web/BFF OIDC flow in `apps/web`.
- Added trusted internal auth headers and role-based access control to `apps/api`.
- Restricted prompt management and destructive actions to `admin`.
- Unified the public login/start page with the `Monitoring` standard.
