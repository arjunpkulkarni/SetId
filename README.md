# f-splitr

React Native (Expo) client for the SPLTR / WealthSplit bill-splitting app. It talks to the Python API in [B-SPLTR](https://github.com/arjunpkulkarni/B-SPLTR) (FastAPI).

## What is in this repository

- **`ReactNativeApp/`** — Expo app: `App.js` (navigation stacks), `src/contexts/AuthContext.js` (session + phone OTP + backend JWT), `src/services/api.js` (axios client, interceptors, `authApi`, `dashboard`, `bills`, `notifications`, etc.), and screens under `src/screens/` (e.g. phone auth, dashboard).
- **Configuration** — `ReactNativeApp/app.json`, `package.json`; dev API base URL is chosen in `api.js` (e.g. localhost / emulator hosts).
- **Relationship to backend** — Auth tokens are stored via secure storage; API responses are normalized in the axios layer (`response.data`), with `unwrap()` used where the backend returns `{ success, data, error }` envelopes.

## Recent work (main)

Single navigator entry in `App.js`, one consolidated `api.js` module, AuthContext aligned with `unwrap`/`authApi` (phone OTP + JWT), and `DashboardScreen.js` with a consistent top bar (notifications + logout).
