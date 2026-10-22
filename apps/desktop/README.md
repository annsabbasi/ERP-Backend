# @erp/desktop

Electron shell around the web app. In development it loads http://localhost:5173 (start the web app
first, or run `pnpm dev` at the root). Packaging is configured in `electron-builder.yml`; installers
are built by a later task.

Security baseline: context isolation, sandbox, no Node.js in the page, no default menu on Windows,
DevTools in development only, navigation limited to the app's own origin (other links open in the
system browser), and a preload that exposes only `window.device.info()`.
