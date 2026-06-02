# Changelog

## 2026-06-01
- Fixed `meetings` page SSR data loading to call the internal API directly with trusted auth headers, avoiding session loss on navigation from the main LMS screen.
- Added EcoAuth/Logto authentication to `EcoLMS` using a web/BFF OIDC flow in `apps/web`.
- Added trusted internal auth headers and role-based access control to `apps/api`.
- Restricted prompt management and destructive actions to `admin`.
- Unified the public login/start page with the `Monitoring` standard.
