# 🔱 Premium MVC-PWA & Native Web Component Onboarding Wizard

A state-of-the-art, premium Single Page Application (SPA) and Progressive Web App (PWA) built using **pure native browser APIs** and **modular Web Components** (zero heavy external frameworks). It features custom gesture overlays, a fluid multi-step **Setup Wizard**, robust offline caching, and a containerized test harness.

---

## 🏗️ Architectural Foundations

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
* **Dynamic Resolvers (`import.meta.resolve`)**: Markup templates are resolved dynamically at runtime and injected into the Shadow DOM:
  ```typescript
  const response = await fetch(import.meta.resolve('./todo-input.html'));
  this.shadow.innerHTML = await response.text();
  ```
* **Native View Transitions**: Step toggling and view switches leverage `document.startViewTransition` for fluid, hardware-accelerated animations.

---

## ✨ Features & Capabilities

### 1. PWA & Offline Caching Integrity
* **Offline-First Proxy**: A custom Service Worker (`public/sw.js`) intercepts assets.
* **Cache Storage (Cache API)**: Pre-caches core bundles (`/index.html`, `/styles/main.css`, components, and icons) allowing the app to load instantly offline.
* **A2HS Metadata**: Includes a robust `manifest.json` configured for standalone immersive display and curated brand colors.

### 2. Multi-Step Onboarding Wizard
* **Step 1: Account Setup**: Real-time username input with a `300ms` debounce timer that queries mock availability endpoints (`/api/check-username`) and displays color-coded feedback.
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
