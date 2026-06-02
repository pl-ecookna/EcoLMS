# Changelog

## 2026-06-02
- Fixed LMS course selection in the left panel after auth rollout: cards now show pointer affordance, highlight by active selection immediately, avoid nested interactive markup, and retry detail loading when the selected course has an empty right pane.
- Added explicit links from `EcoLMS` docs to the shared `EcoAuth` authorization and `Logto` reference documents.

## 2026-06-01
- Fixed `meetings` page SSR data loading to call the internal API directly with trusted auth headers, avoiding session loss on navigation from the main LMS screen.
- Added EcoAuth/Logto authentication to `EcoLMS` using a web/BFF OIDC flow in `apps/web`.
- Added trusted internal auth headers and role-based access control to `apps/api`.
- Restricted prompt management and destructive actions to `admin`.
- Unified the public login/start page with the `Monitoring` standard.
