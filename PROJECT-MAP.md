# Project Map

## Core Backend

`src/stc-mod/index.js` exports the sidecar entry points used by SillyTavern:

- `shouldSkipCsrf(req)`
- `setupPublicRoutes(app)`
- `setupPublicApi(app)`
- `setupPrivateRoutes(app)`

## Main Feature Areas

- Registration and invitation codes:
  - `src/stc-mod/routes/public/register.js`
  - `src/stc-mod/routes/private/invitation-codes.js`
  - `src/stc-mod/services/invitation-codes.js`
- User metadata and account extension:
  - `src/stc-mod/user-metadata.js`
  - `src/stc-mod/routes/private/user-extend.js`
- Announcements:
  - `src/stc-mod/routes/private/announcements.js`
  - `src/stc-mod/routes/public/announcements-public.js`
- Email:
  - `src/stc-mod/services/email-service.js`
  - `src/stc-mod/routes/private/email-config.js`
- OAuth:
  - `src/stc-mod/routes/public/oauth.js`
  - `src/stc-mod/routes/private/oauth-config.js`
- Storage quota:
  - `src/stc-mod/services/storage-quota.js`
  - `src/stc-mod/middleware/storage-enforce.js`
  - `src/stc-mod/routes/private/user-storage.js`
- Forum:
  - `src/stc-mod/public/forum.html`
  - `src/stc-mod/routes/private/forum.js`
- Public characters:
  - `src/stc-mod/public/public-characters.html`
  - `src/stc-mod/routes/private/public-characters.js`
- Default user template:
  - `src/stc-mod/services/default-template.js`
  - `src/stc-mod/routes/private/default-config.js`
- Privacy vault service and API:
  - `src/stc-mod/services/privacy-vault.js`
  - `src/stc-mod/routes/private/privacy-vault.js`
- System monitoring and scheduled tasks:
  - `src/stc-mod/services/system-monitor.js`
  - `src/stc-mod/routes/private/system-load.js`
  - `src/stc-mod/routes/private/scheduled-tasks.js`

## Frontend Extension

`public/scripts/extensions/third-party/stc-admin-panel/` contains the
SillyTavern extension manifest, scripts, and styles.

It is not useful by itself unless the backend `/api/stc/*` routes are loaded.
