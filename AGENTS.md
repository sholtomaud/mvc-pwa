# Instructions for Agentic Developers

We have a very specific development workflow and set of constraints. Please read these instructions very carefully and follow them to the letter.

## Focus

We always focus on using the latest native browser features and prefer HTML/CSS APIs over Javascript where possible. When generating HTML, please ensure it is semantically correct and accessible.

We then add JS/TS only as needed to make it do something, and we only support native Web Components and other browser APIs. 

This means we NEVER use frameworks like React.js or Angular.js etc. We only support native Web Components and other browser APIs.

## Development Environment & Build Tools

We do not have Node.js installed locally on our host machines. Instead, our workspace utilizes a custom **Apple container CLI system** (`container` binary) managed via a **Makefile** to download, configure, and isolate our build tools (e.g., Vite for compiling TypeScript, Vitepress for documentation).

### Single Source of Truth for Configuration
- The target Node.js version is stored in a local `.node-version` file (containing `25`), which is parsed dynamically by build scripts and make targets.

### Container Daemon & CLI Setup
All container interactions are controlled via the `container` binary. Prior to performing any actions, the container daemon must be running. We enforce health checks by running the custom daemon validation:
```bash
container system start
```

When writing setup instructions, configuration files, scripts, or troubleshooting steps, always keep the following `Containerfile` ecosystem constraints in mind:

```Containerfile
ARG NODE_VERSION=25
FROM node:${NODE_VERSION}-slim

WORKDIR /app

ENV NODE_ENV=development
ENV CI=true
ENV NODE_OPTIONS=--max-old-space-size=3072

CMD ["bash"]
```

- Build Commands: Assume all `vite`, `tsc`, or `npm` commands are run via a local Makefile that triggers execution inside this specific container context using `container run`.

- Target Environment: Write modern TypeScript configurations targeting Node 25+ features for compilation, generating pure ESM browser outputs.

## File Structure & Component Architecture

Every single Web Component must be strictly broken down into **three separate files**. This allows us to leverage native IDE linting for HTML and CSS. 

For any component named `component-name`, you must generate:
1. `component-name.html` - Containing only the template markup.
2. `component-name.css` - Containing only the component styles.
3. `component-name.ts` - Containing the TypeScript class definition, utilizing strong typing.

### Rules for Component Implementation:
* **No Embedded HTML/CSS Strings:** Never write HTML markup or CSS rules as raw string literals inside the TypeScript file.
* **TypeScript Mandatory:** Always use TypeScript (`.ts`) for logic, ensuring proper type definitions for elements, events, and properties.
* **Native ESM Imports Only:** Use native browser ECMAScript Modules (ESM) to load dependencies. 
  * For CSS, use native CSS module scripts: `import sheet from './component-name.css' assert { type: 'css' };` (or `with { type: 'css' }` depending on your target spec version) and apply it via `shadowRoot.adoptedStyleSheets`.
  * For HTML, since native HTML modules are not fully ubiquitous, natively `fetch` the file text or use a clean async initialization pattern to inject the template text, keeping the source HTML file entirely separate.

### Expected Output Example

When asked to build a component like `todo-input`, you must output three distinct files exactly like this:

#### 1. todo-input.html
```html
<div class="fab-container">
  <button class="fab-btn" aria-label="Add new todo item" aria-haspopup="dialog">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  </button>
</div>

<dialog class="todo-dialog" aria-labelledby="dialog-title">
  </dialog>
```

#### 2. todo-input.css

```CSS
.fab-container {
  position: fixed;
  bottom: 2rem;
  right: 2rem;
}
/* Remaining styles here */
```

#### 3. todo-input.ts

```typescript
// Native ESM CSS Module Script import
import styles from './todo-input.css' assert { type: 'css' };

class TodoInput extends HTMLElement {
  private shadow: ShadowRoot;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    // Apply the imported native stylesheet directly to the shadow root
    this.shadow.adoptedStyleSheets = [styles];
  }

  async connectedCallback(): Promise<void> {
    await this.render();
    this.setupListeners();
  }

  private async render(): Promise<void> {
    // Natively fetch the separate HTML template file
    const response = await fetch(import.meta.resolve('./todo-input.html'));
    const htmlText = await response.text();
    this.shadow.innerHTML = htmlText;
  }

  private setupListeners(): void {
    const dialog = this.shadow.querySelector('.todo-dialog') as HTMLDialogElement;
    const fabBtn = this.shadow.querySelector('.fab-btn') as HTMLButtonElement;
    const form = this.shadow.querySelector('.todo-form') as HTMLFormElement;
    const input = this.shadow.querySelector('.todo-text-input') as HTMLInputElement;

    fabBtn.addEventListener('click', () => {
      dialog.showModal();
      fabBtn.classList.add('open');
      setTimeout(() => input.focus(), 50);
    });

    // Remaining strongly-typed listeners using this.shadow...
  }
}

customElements.define('todo-input', TodoInput);
```

---

### Key Adjustments for Native ESM:
* **`assert { type: 'css' }`:** This tells the browser engine to parse the incoming file directly as a `CSSStyleSheet` object instead of a JS module. 
* **`shadowRoot.adoptedStyleSheets`:** This is the native browser API designed specifically to work alongside CSS module scripts. It ensures perfect style isolation within the Web Component without needing to drop a `<style>` string into your HTML.
* **`import.meta.resolve()`:** This natively resolves the URL path relative to the current TypeScript/JavaScript file location, making the standard browser `fetch()` call for the `.html` file bulletproof regardless of where the component is being served from.

---

### What this accomplishes:
1. **Frames Context:** The developer agent now understands that you are compiling files via Vite/tsc inside a container context, so it won't write code or setup guidelines that assume a native host environment installation.
2. **Reinforces ESM Compliance:** By knowing the container environment is tracking standard modern engines (Node 25), the agent will consistently reach for standard ESM paradigms (`import.meta.resolve`, `with { type: 'css' }`) instead of legacy fallback hacks.

---

## Vanilla & Modern Web Development Guidelines

To ensure the codebase utilizes the most performant, accessible, and native browser features, any agent developing in this repository must follow these standards in alignment with standard W3C and Baseline capabilities:

### 1. Native Overlays & Interactivity
- **Popovers**: Use `popover="auto"` or `popover="manual"` for non-modal overlays, dropdown menus, context menus, and tooltips. Popovers are natively promoted to the browser's top layer.
- **Dialogs**: Use standard `<dialog>` elements for modal interfaces. Always invoke them using `.showModal()` to automatically activate browser focus trapping, accessibility tree pruning, and standard backdrop rendering.
- **Light Dismiss**: For custom or manual popovers, always add click listeners targeting areas outside the boundary to close them cleanly.

### 2. Gesture-Driven Interactivity & Scroll Snap
- **Gestural Panels**: For slide-out sheets and carousels, prefer CSS Scroll Snap (`scroll-snap-type: x mandatory`) with horizontal/vertical container columns over manual pointer drag listeners. Snapping uses native browser compositor momentum.
- **Scroll-Driven Animations**: Use `@supports (animation-timeline: scroll())` for animations tied to scroll position (e.g. fading backdrops on drag, scroll progress bars). Provide simple JS-driven scroll position fallbacks only when the native API is unsupported.

### 3. Accessible Interactivity (A11y)
- **Roles & Attributes**: Custom controls (like custom checkboxes, toggle switch buttons, or tabs) must declare explicit semantic ARIA roles (e.g., `role="checkbox"`, `role="tab"`) and reflect active states dynamically using `aria-checked` or `aria-selected` attributes.
- **Keyboard Traps & Inertness**: Native `<dialog>.showModal()` manages focus trapping natively. When building custom drawers or overlays that cover the screen, assign the `inert` attribute to all background containers (like `<main>`) to prevent screen-readers or keyboard Tab indices from highlighting background nodes.
- **User Preference Alignment**: Always support `@media (prefers-reduced-motion: reduce)` by instantly disabling or scaling down all visual transitions and animations.

### 4. Native View Transitions (Routing)
- **SPA View Swapping**: Avoid heavy framework routers. When updating the DOM to switch between views or navigation states in a Single Page Application, wrap the updates inside the **View Transitions API** to provide fluid app-like animations natively:
  ```typescript
  if (document.startViewTransition) {
    document.startViewTransition(() => {
      // Perform DOM updates to toggle views
    });
  } else {
    // Fallback for direct DOM updates
  }
  ```