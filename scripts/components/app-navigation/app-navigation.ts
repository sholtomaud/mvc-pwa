import sheet from './app-navigation.css' with { type: 'css' };
import type { Profile } from '../user-profile/user-profile';

class AppNavigation extends HTMLElement {
  private shadow: ShadowRoot;
  private isOpening: boolean = false;
  // Stored so we can detach the exact same function reference on close
  private outsideClickListener: ((e: MouseEvent) => void) | null = null;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    this.shadow.adoptedStyleSheets = [sheet];
  }

  async connectedCallback(): Promise<void> {
    await this.render();
    this.setupDrawer();
    this.setupProfileSync();
    this.setupRouteSync();
  }

  private async render(): Promise<void> {
    const response = await fetch(import.meta.resolve('./app-navigation.html'));
    const htmlText = await response.text();
    this.shadow.innerHTML = htmlText;
  }

  private setupDrawer(): void {
    const drawer = this.shadow.querySelector('#app-drawer') as HTMLDivElement | null;
    const openBtn = this.shadow.querySelector('#drawer-open') as HTMLButtonElement | null;
    const scroller = this.shadow.querySelector('.Drawer-scroller') as HTMLDivElement | null;
    const sheet = this.shadow.querySelector('.Drawer-sheet') as HTMLElement | null;

    if (!drawer || !openBtn || !scroller || !sheet) return;

    // ─── Core trigger actions ──────────────────────────────
    const openDrawer = async () => {
      this.isOpening = true;
      scroller.style.scrollSnapType = 'x mandatory';
      drawer.showPopover();

      // Fallback for browsers that don't support scroll-initial-target
      if (!CSS.supports('scroll-initial-target', 'nearest')) {
        scroller.scrollTo({ left: scroller.offsetWidth, behavior: 'instant' });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      }

      scroller.scrollTo({ left: 0, behavior: 'auto' });
    };

    const closeDrawerSmooth = () => {
      // Use the sheet's actual rendered width as the precise close scroll target
      // (= var(--drawer-width)). Fall back to scroller.offsetWidth if not yet rendered.
      const closeTarget = sheet.offsetWidth > 0 ? sheet.offsetWidth : scroller.offsetWidth;
      scroller.style.scrollSnapType = 'none';
      scroller.scrollTo({ left: closeTarget, behavior: 'smooth' });

      // Re-enable snap after the smooth scroll animation completes
      setTimeout(() => {
        scroller.style.scrollSnapType = 'x mandatory';
      }, 400);
    };

    const closeDrawerInstant = () => {
      this.isOpening = false;
      drawer.hidePopover();
    };

    // ─── Attach / detach outside-click listener ────────────
    // Lifecycle-gated: only active while the drawer is open, so it never
    // interferes with other interactions and avoids race conditions on open.
    const attachOutsideListener = () => {
      this.outsideClickListener = (e: MouseEvent) => {
        const path = e.composedPath();
        // Ignore clicks on the open button — it handles its own toggle
        if (path.includes(openBtn as EventTarget)) return;
        // Close gracefully if click landed outside the drawer sheet panel
        if (!path.includes(sheet as EventTarget)) {
          closeDrawerSmooth();
        }
      };
      // Capture phase: fires before the event reaches any other listener,
      // and crucially does NOT fire for scroll gestures (only clean clicks)
      document.addEventListener('click', this.outsideClickListener, { capture: true });
    };

    const detachOutsideListener = () => {
      if (this.outsideClickListener) {
        document.removeEventListener('click', this.outsideClickListener, { capture: true });
        this.outsideClickListener = null;
      }
    };

    // ─── Open button: toggle open / close ─────────────────
    openBtn.addEventListener('click', (e: MouseEvent) => {
      // stopPropagation keeps this click from reaching the outside-click listener
      // (handled by the path.includes(openBtn) check in attachOutsideListener anyway)
      e.stopPropagation();
      if (openBtn.getAttribute('aria-expanded') === 'true') {
        closeDrawerSmooth();
      } else {
        openDrawer();
      }
    });

    // ─── IntersectionObserver: open/close state machine ───
    const getRootMain = (): HTMLElement | null => {
      const root = this.getRootNode() as ShadowRoot;
      return root.querySelector ? root.querySelector('#app-main-content') as HTMLElement | null : null;
    };

    const onDrawerOpened = () => {
      if (openBtn.getAttribute('aria-expanded') === 'true') return;
      openBtn.setAttribute('aria-expanded', 'true');
      sheet.focus({ preventScroll: true });
      this.isOpening = false;

      // Trap focus in background content
      const mainEl = getRootMain();
      if (mainEl) mainEl.inert = true;

      // NOW safe to attach the outside-click listener — the opening click
      // sequence is already complete (IO fires asynchronously after showPopover)
      attachOutsideListener();
    };

    const onDrawerClosed = () => {
      if (this.isOpening) return; // Guard: don't fire during initial open animation
      if (openBtn.getAttribute('aria-expanded') === 'false') return;
      drawer.hidePopover();
      openBtn.setAttribute('aria-expanded', 'false');

      // Release focus trap
      const mainEl = getRootMain();
      if (mainEl) mainEl.inert = false;

      // Detach the outside-click listener — no longer needed
      detachOutsideListener();
    };

    // IO watches the sheet panel visibility within the popover scroller
    const visibleThreshold = 0.01;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries.at(-1);
        if (!entry) return;
        if (entry.intersectionRatio < visibleThreshold) {
          onDrawerClosed();
        } else if (entry.intersectionRatio > 0.95) {
          onDrawerOpened();
        }
      },
      { root: drawer, threshold: [visibleThreshold, 0.99] }
    );
    observer.observe(sheet);

    // ─── Scroll timeline backdrop fallback ────────────────
    if (!CSS.supports('animation-timeline: scroll()')) {
      scroller.addEventListener('scroll', () => {
        const ratio = 1 - scroller.scrollLeft / sheet.offsetWidth;
        drawer.style.setProperty('--drawer-backdrop', Math.max(0, Math.min(1, ratio)).toString());
      });
    }

    // ─── Escape key ───────────────────────────────────────
    this.shadow.addEventListener('keydown', (e: Event) => {
      if ((e as KeyboardEvent).key === 'Escape') {
        closeDrawerSmooth();
      }
    });

    // ─── Nav link routing + close ─────────────────────────
    const drawerLinks = this.shadow.querySelectorAll('.drawer-link');
    const desktopLinks = this.shadow.querySelectorAll('.desktop-link');
    const allLinks = [...drawerLinks, ...desktopLinks];

    allLinks.forEach((link) => {
      link.addEventListener('click', (e: Event) => {
        e.preventDefault();
        const target = e.currentTarget as HTMLAnchorElement;
        const route = target.getAttribute('data-route');
        if (!route) return;

        allLinks.forEach((l) => {
          if (l.getAttribute('data-route') === route) {
            l.classList.add('active');
          } else {
            l.classList.remove('active');
          }
        });

        this.dispatchEvent(new CustomEvent('view-change', {
          bubbles: true,
          composed: true,
          detail: { route }
        }));

        closeDrawerSmooth();
      });
    });
  }

  private setupProfileSync(): void {
    const updateBadge = (profile: Profile) => {
      const nameEl = this.shadow.querySelector('.preview-name');
      const targetEl = this.shadow.querySelector('.preview-target');
      if (nameEl) nameEl.textContent = profile.username;
      if (targetEl) targetEl.textContent = `Daily Target: ${profile.target} tasks`;
    };

    const stored = localStorage.getItem('user-profile');
    if (stored) {
      updateBadge(JSON.parse(stored));
    }

    window.addEventListener('profile-update', (e: Event) => {
      const customEvent = e as CustomEvent<Profile>;
      updateBadge(customEvent.detail);
    });
  }

  private setupRouteSync(): void {
    const updateActiveLinks = (route: string) => {
      const drawerLinks = this.shadow.querySelectorAll('.drawer-link');
      const desktopLinks = this.shadow.querySelectorAll('.desktop-link');
      const allLinks = [...drawerLinks, ...desktopLinks];

      allLinks.forEach((l) => {
        if (l.getAttribute('data-route') === route) {
          l.classList.add('active');
        } else {
          l.classList.remove('active');
        }
      });
    };

    // Listen to global composed routing events bubbling to window
    window.addEventListener('view-change', (e: Event) => {
      const customEvent = e as CustomEvent<{ route: string }>;
      updateActiveLinks(customEvent.detail.route);
    });
  }
}

customElements.define('app-navigation', AppNavigation);
export default AppNavigation;
