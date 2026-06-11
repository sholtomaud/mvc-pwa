# 🔱 mvc-pwa — Native Web Component Todo App

A Todo App built as a Single Page Application (SPA) and Progressive Web App (PWA) using **pure native browser APIs** and **modular Web Components** (zero heavy external frameworks). It features a genuine MVC architecture, a multi-step profile **Setup Wizard**, offline-first caching with a build-time precache manifest, and a containerized test harness.

---

## 🏗️ Architectural Foundations

The app follows a genuine MVC split with zero framework code:

* **Model** — `scripts/store/`: a `TodoStore` (native `EventTarget`) that owns the todo collection as **local-first, sync-ready CRDT records**: per-field last-writer-wins registers stamped by a Hybrid Logical Clock (`hlc.ts`), tombstone deletes, and a tested deterministic merge (`todo-record.ts`). Persistence is IndexedDB with a localStorage fallback (`persistence.ts`), write-behind so the UI never blocks, with one-time migration of pre-existing localStorage data. `TodoStore.applyRemote()` is the future sync entry point — adding multi-device sync is now a transport problem, not a data-model rewrite (see `TODO.md`).
* **View** — the Web Components under `scripts/components/`: `todo-list` renders whatever collection it is given, reconciling the DOM keyed by todo id (in-place patches, never a full re-render).
* **Controller** — `todo-app`: translates bubbling view events (`todo-add`, `todo-toggle`, …) into store mutations and pushes store state into the views on every `change`.

We follow a strict **Triple-File Native Web Component** convention to preserve clean IDE parsing and complete style isolation. For every component `[component-name]`, we maintain:
1. `[component-name].html` - Pure semantic HTML markup template.
2. `[component-name].css` - Scoped Vanilla CSS styles.
3. `[component-name].ts` - Strongly-typed TypeScript logic class.

### Key Browser APIs Adopted
* **CSS Module Scripts & `adoptedStyleSheets`**: Scoped styles are imported directly as `CSSStyleSheet` objects and adopted by shadow roots to prevent style bleed:
  ```typescript
  import sheet from './todo-input.css' with { type: 'css' };
  this.shadow.adoptedStyleSheets = [sheet];
  ```
* **Bundled HTML Templates (`?raw` imports)**: Markup templates are imported as raw strings at build time and stamped into the Shadow DOM — no runtime fetch, so component markup ships inside the precached JS bundle and works fully offline:
  ```typescript
  import htmlText from './todo-input.html?raw';
  this.shadow.innerHTML = htmlText;
  ```
* **Native View Transitions**: Step toggling and view switches leverage `document.startViewTransition` for fluid, hardware-accelerated animations.

---

## ✨ Features & Capabilities

### 1. PWA & Offline Caching Integrity
* **Offline-First Proxy**: A custom Service Worker (`public/sw.js`) intercepts assets.
* **Build-Time Precache Manifest**: A small Vite plugin (`sw-precache-manifest` in `vite.config.ts`) injects the complete list of emitted build files — including the hashed JS/CSS bundles — into `sw.js` at build time, plus a content-derived build id used as the cache name. The app is fully offline-capable after the first visit, and stale caches are dropped on every deploy.
* **A2HS Metadata**: Includes a robust `manifest.json` configured for standalone immersive display and curated brand colors.

### 2. Multi-Step Onboarding Wizard
* **Step 1: Account Setup**: Real-time username input with a `300ms` debounce timer that queries an availability endpoint (`/api/check-username` — mocked via `page.route` in the Playwright suite; in production the request fails over to the offline fallback path) and displays color-coded feedback.
* **Step 2: Preferences**: Supports daily target limits and home address settings.
* **State Preservation**: Input values remain perfectly preserved in the DOM when navigating backwards using the "Previous" button.
* **Success Routing & Fallback**: Validates fields using standard HTML5 constraints, submits to `/api/save-profile`, and falls back to `localStorage` commits if offline, flashing status indications.

### 3. Responsive Navigation Drawer
* **Focus Trapping**: Opening the mobile drawer sets the `inert` attribute on the background container (`#app-main-content`) to protect keyboard and screen-reader navigation.
* **Backdrop Clicking**: Clicking the dim background scroller overlay safely dismisses the drawer.
* **Gesture Swipe Dismissal**: Utilizes CSS scroll-snap momentum columns to dismiss panels via horizontal drag swiping.

---

## 🛠️ Local Development & Container Setup

We utilize an isolated **Apple container CLI system** managed via a local `Makefile` to run builds and test engines inside a standardized `node:25-slim` image context.

### Commands Overview

* **Build the Dev Image**:
  ```bash
  make image
  ```
* **Install Node Dependencies**:
  ```bash
  make install
  ```
* **Start Vite Development Server**:
  ```bash
  make dev
  ```
  *(Launches hot-reload server at `http://localhost:5173/`)*

* **Compile Optimized Static Bundles**:
  ```bash
  make build-app
  ```
  *(Outputs static assets to `/dist`)*

* **Run Playwright E2E Integration Suite**:
  ```bash
  make test
  ```

---

## 🧪 Testing Suite & Accessibility (Playwright)

We run **14 high-fidelity E2E integration specs** (`tests/todo-flow.spec.ts`) validating every UX constraint:
1. **PWA Integrity**: Manifest metadata checks, service worker activation triggers, and offline emulation (`context.setOffline(true)`) verifying `localStorage` commits persist.
2. **Navigation Drawer**: Viewport toggling checks, backdrop click-dismissals, scroll-snap gesture simulations, and `inert` focus trapping.
3. **Form Constraints**: Wizard step state preservation, debounced input triggers with mock route interceptions (`page.route`), and success routing syncing target previews.
4. **Accessibility (a11y) gates**: Run automated Axe-core accessibility scans (`@axe-core/playwright`) over steps to verify WCAG color contrasts, ARIA expandables, and semantic hierarchies (e.g. single visible `<h1>` tags).
5. **Visual Regressions**: Programmatically saves baseline screenshots of drawers and wizard fields inside `test-results/baselines/` across Chromium, WebKit, and Firefox engines.

---

## 🚀 CI/CD & Infrastructure Pipelines

### GitHub Actions Deployment
Our pipeline (`.github/workflows/deploy.yml`) runs on every merge to `main`:
1. Installs project dependencies.
2. Registers Playwright headless engines and OS libraries.
3. Executes E2E test suites.
4. Builds optimized static assets.
5. Deploys `/dist` directly to **GitHub Pages**.

### AWS CDK Pipeline Stack
The codebase includes a comprehensive **AWS CDK WebAppPipelineStack** (`cdk/lib/stack.ts`) deploying infrastructure through a robust 7-stage promotion lifecycle:
* **Stage 1 (Hygiene)**: Static analysis, unit tests, `cfn-lint`, and SAST checks.
* **Stage 2 (Asset Build)**: Code compilation and asset bundle budget validations.
* **Stage 3 (Localized Integration)**: Consumer contracts and component integration.
* **Stage 4 (Deploy)**: Deploys CloudFormation stacks dynamically to Staging environments.
* **Stage 5 (Post-Deployment)**: Live endpoint health and DAST security scans.
* **Stage 6 (E2E Gates)**: Large-scale Playwright integration and `k6` stress testing.
* **Stage 7 (Promotion)**: Pauses at a manual approval gate before launching Live Production.
