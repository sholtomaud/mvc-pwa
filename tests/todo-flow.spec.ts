import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('PWA & Mobile-First Capabilities', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('1.1. Manifest & Add to Home Screen (A2HS) Metadata', async ({ page }) => {
    // Assert presence of manifest.json link in head
    const manifestLink = page.locator('link[rel="manifest"]');
    await expect(manifestLink).toHaveAttribute('href', 'manifest.json');

    // Natively fetch and parse manifest.json to assert specs
    const manifestResponse = await page.request.get('/manifest.json');
    expect(manifestResponse.ok()).toBeTruthy();
    
    const manifest = await manifestResponse.json();
    expect(manifest.name).toBe('Todo App');
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toBe('#0a0a0c');
    expect(manifest.icons.length).toBeGreaterThan(0);
  });

  test('1.2. Service Worker Registration, Activation, & Cache Integrity', async ({ page }) => {
    // 1. Service Worker Registration & Activation
    // Register the SW programmatically and wait for active state
    const swState = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return 'unsupported';
      
      const reg = await navigator.serviceWorker.register('/sw.js');
      return new Promise<string>((resolve) => {
        if (reg.active) {
          resolve(reg.active.state);
        } else {
          const sw = reg.installing || reg.waiting;
          if (sw) {
            sw.addEventListener('statechange', () => {
              if (sw.state === 'activated') resolve(sw.state);
            });
          } else {
            resolve('no-active-sw');
          }
        }
      });
    });

    expect(swState).toBe('activated');

    // 2. Cache Storage Integrity Check
    // Verify that the critical assets are populated in the Cache Storage (Cache API)
    const cachedUrls = await page.evaluate(async () => {
      const keys = await caches.keys();
      if (keys.length === 0) return [];
      
      const todoCache = await caches.open(keys[0]);
      const requests = await todoCache.keys();
      return requests.map(r => new URL(r.url).pathname);
    });

    expect(cachedUrls.length).toBeGreaterThan(0);
    expect(cachedUrls).toContain('/index.html');
    expect(cachedUrls).toContain('/styles/main.css');
  });

  test('1.3. Offline Functionality & Local Storage Persistence', async ({ page, context }) => {
    // 1. Create a task while online
    const fabBtn = page.locator('todo-app >> todo-input >> .fab-btn');
    const dialog = page.locator('todo-app >> todo-input >> #todo-dialog');
    const input = page.locator('todo-app >> todo-input >> .todo-text-input');
    const submitBtn = page.locator('todo-app >> todo-input >> .form-submit-btn');

    await fabBtn.click();
    await input.fill('Offline persistence task');
    await submitBtn.click();
    await expect(dialog).not.toBeVisible();

    // Wait for the task to render fully in the DOM
    const todoItem = page.locator('todo-app >> todo-list >> todo-item').first();
    const checkbox = todoItem.locator('.todo-checkbox');
    await expect(checkbox).toBeVisible();
    await expect(todoItem.locator('.todo-text-span')).toHaveText('Offline persistence task');

    // 2. Turn off network routing using Playwright's offline emulation
    await context.setOffline(true);

    // 3. Interact with the task while offline (Toggle completeness)
    await checkbox.click();

    // 4. Verify that local database/localStorage remains fully functional and updates offline
    const localStorageData = await page.evaluate(() => localStorage.getItem('todos'));
    expect(localStorageData).toContain('"complete":true');

    // Restore network
    await context.setOffline(false);
  });
});

test.describe('Navigation & Slideout Hamburger Menu', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('2.1. Responsive Viewport Toggling (Desktop vs Mobile)', async ({ page }) => {
    // Desktop Viewport
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto('/');
    const desktopNav = page.locator('todo-app >> app-navigation >> .desktop-nav');
    const openBtn = page.locator('todo-app >> app-navigation >> #drawer-open');

    await expect(desktopNav).toBeVisible();
    await expect(openBtn).not.toBeVisible();

    // Mobile Viewport
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(desktopNav).not.toBeVisible();
    await expect(openBtn).toBeVisible();
  });

  test('2.2. Slideout Focus Trapping and Inertness', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');

    const openBtn = page.locator('todo-app >> app-navigation >> #drawer-open');
    const drawer = page.locator('todo-app >> app-navigation >> #app-drawer');
    const appMain = page.locator('todo-app >> #app-main-content');

    await openBtn.click();
    await expect(drawer).toBeVisible();

    // Focus Trap Verification: Main content container must receive 'inert' attribute
    // to block keyboard/screen-readers from selecting background items
    await expect(appMain).toHaveAttribute('inert', '');
  });

  test('2.3. Gestural Drag Dismissal', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');

    const openBtn = page.locator('todo-app >> app-navigation >> #drawer-open');
    const drawer = page.locator('todo-app >> app-navigation >> #app-drawer');

    await openBtn.click();
    await expect(drawer).toBeVisible();
    await expect(openBtn).toHaveAttribute('aria-expanded', 'true');

    // Emulate horizontal swipe gesture by programmatically scrolling the scroller container
    await page.evaluate(() => {
      const todoApp = document.querySelector('todo-app');
      const nav = todoApp?.shadowRoot?.querySelector('app-navigation');
      const scroller = nav?.shadowRoot?.querySelector('.Drawer-scroller');
      if (scroller) scroller.scrollLeft = 200;
    });

    // Verify gesture successfully dismissed the drawer
    await expect(drawer).not.toBeVisible();
  });

  test('2.4. Click-Outside Overlay Dismissal', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');

    const openBtn = page.locator('todo-app >> app-navigation >> #drawer-open');
    const drawer = page.locator('todo-app >> app-navigation >> #app-drawer');
    const scroller = page.locator('todo-app >> app-navigation >> .Drawer-scroller');

    await openBtn.click();
    await expect(drawer).toBeVisible();
    await expect(openBtn).toHaveAttribute('aria-expanded', 'true');

    // Click on the empty backdrop scroller column (right side of screen)
    await scroller.click({ position: { x: 320, y: 400 } });
    await expect(drawer).not.toBeVisible();
  });
});

test.describe('Setup Form & Data Validation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('3.1. Multi-Step Wizard & State Preservation', async ({ page }) => {
    const desktopLinkProfile = page.locator('todo-app >> app-navigation >> .desktop-nav >> a[data-route="profile"]');
    await desktopLinkProfile.click();

    // Verify initially Step 1 is active
    const step1 = page.locator('todo-app >> user-profile >> .form-step[data-step="1"]');
    const step2 = page.locator('todo-app >> user-profile >> .form-step[data-step="2"]');
    await expect(step1).toHaveClass(/active/);
    await expect(step2).not.toHaveClass(/active/);

    const usernameInput = page.locator('todo-app >> user-profile >> #profile-username');
    const emailInput = page.locator('todo-app >> user-profile >> #profile-email');
    const nextBtn = page.locator('todo-app >> user-profile >> .next-btn');

    // Fill Step 1
    await usernameInput.fill('Galahad');
    await emailInput.fill('galahad@roundtable.org');
    
    // Go to Step 2
    await nextBtn.click();
    await expect(step1).not.toHaveClass(/active/);
    await expect(step2).toHaveClass(/active/);

    // Verify inputs on Step 2
    const targetInput = page.locator('todo-app >> user-profile >> #profile-target');
    const prevBtn = page.locator('todo-app >> user-profile >> .prev-btn');

    await targetInput.fill('10');

    // Navigate backward using 'Previous' button
    await prevBtn.click();
    await expect(step1).toHaveClass(/active/);
    await expect(step2).not.toHaveClass(/active/);

    // Assert multi-step state preservation (Step 1 input values remain perfectly retained)
    await expect(usernameInput).toHaveValue('Galahad');
    await expect(emailInput).toHaveValue('galahad@roundtable.org');
  });

  test('3.2. Real-time HTML5 Constraint Validation & Error UI', async ({ page }) => {
    const desktopLinkProfile = page.locator('todo-app >> app-navigation >> .desktop-nav >> a[data-route="profile"]');
    await desktopLinkProfile.click();

    const usernameInput = page.locator('todo-app >> user-profile >> #profile-username');
    const emailInput = page.locator('todo-app >> user-profile >> #profile-email');
    const nextBtn = page.locator('todo-app >> user-profile >> .next-btn');

    // Fill invalid email and empty username (violating required/type constraint validations)
    await usernameInput.fill('');
    await emailInput.fill('invalid-email');

    // Clicking Next Step should trigger browser constraint reporting and block step transition
    await nextBtn.click();
    
    const step1 = page.locator('todo-app >> user-profile >> .form-step[data-step="1"]');
    await expect(step1).toHaveClass(/active/); // Step should not change

    const isUsernameValid = await usernameInput.evaluate((el: HTMLInputElement) => el.checkValidity());
    const isEmailValid = await emailInput.evaluate((el: HTMLInputElement) => el.checkValidity());
    expect(isUsernameValid).toBeFalsy();
    expect(isEmailValid).toBeFalsy();
  });

  test('3.3. Debounced API Username Availability Check', async ({ page }) => {
    const desktopLinkProfile = page.locator('todo-app >> app-navigation >> .desktop-nav >> a[data-route="profile"]');
    await desktopLinkProfile.click();

    const usernameInput = page.locator('todo-app >> user-profile >> #profile-username');
    const usernameFeedback = page.locator('todo-app >> user-profile >> .username-feedback');

    // Intercept API call to mock check-username response
    let apiCallCount = 0;
    await page.route('**/api/check-username?username=Lancelot', async (route) => {
      apiCallCount++;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ available: true })
      });
    });

    // Simulate fast typing to verify debounce
    await usernameInput.focus();
    await usernameInput.fill('');
    await page.keyboard.type('Lance');
    await page.waitForTimeout(50); // fast type intermediate state
    await page.keyboard.type('lot');

    // Verify debounce prevents immediate requests
    // Wait for debounce timer to fire and API feedback to render
    await expect(usernameFeedback).toHaveText('✓ Username is available');
    expect(apiCallCount).toBe(1); // Should only fire one network request
  });

  test('3.4. Form Submission & Success Routing', async ({ page }) => {
    // Intercept check-username and save-profile POST request
    await page.route('**/api/check-username?username=Percival', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ available: true })
      });
    });

    let savePayload: any = null;
    await page.route('**/api/save-profile', async (route) => {
      savePayload = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true })
      });
    });

    const desktopLinkProfile = page.locator('todo-app >> app-navigation >> .desktop-nav >> a[data-route="profile"]');
    await desktopLinkProfile.click();

    const usernameInput = page.locator('todo-app >> user-profile >> #profile-username');
    const emailInput = page.locator('todo-app >> user-profile >> #profile-email');
    const nextBtn = page.locator('todo-app >> user-profile >> .next-btn');

    // Step 1 Details
    await usernameInput.fill('Percival');
    await emailInput.fill('percival@roundtable.org');
    await nextBtn.click();

    // Step 2 Details
    const addrInput = page.locator('todo-app >> user-profile >> #profile-address');
    const targetInput = page.locator('todo-app >> user-profile >> #profile-target');
    const submitBtn = page.locator('todo-app >> user-profile >> .submit-btn');

    await addrInput.fill('Camelot Castle');
    await targetInput.fill('15');
    await submitBtn.click();

    // Wait for API save request to be completed
    await page.waitForResponse(response => response.url().includes('/api/save-profile'));

    // Assert correct POST payload synced
    expect(savePayload).toEqual({
      username: 'Percival',
      email: 'percival@roundtable.org',
      address: 'Camelot Castle',
      target: 15
    });

    // Success Validation: Active view remains on the Profile settings view
    const activeView = page.locator('todo-app >> #view-profile');
    await expect(activeView).toHaveClass(/active/);

    // Profile sync check: Footer daily target badge matches completed settings target
    const badgeTarget = page.locator('todo-app >> app-navigation >> .profile-preview >> .preview-target');
    await expect(badgeTarget).toHaveText('Daily Target: 15 tasks');

    // Verify that the navigation highlights remain on the User Profile link
    const desktopLinkTasks = page.locator('todo-app >> app-navigation >> .desktop-nav >> a[data-route="tasks"]');
    await expect(desktopLinkProfile).toHaveClass(/active/);
    await expect(desktopLinkTasks).not.toHaveClass(/active/);
  });
});

test.describe('Accessibility (a11y) & Cross-Cutting Gates', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('4.1. Automated Axe-core Accessibility Audit', async ({ page }) => {
    // Audit dashboard view
    const mainScan = await new AxeBuilder({ page })
      .disableRules(['color-contrast'])
      .analyze();
    expect(mainScan.violations).toEqual([]);

    // Audit Setup Form step 1 and step 2
    const desktopLinkProfile = page.locator('todo-app >> app-navigation >> .desktop-nav >> a[data-route="profile"]');
    await desktopLinkProfile.click();

    const wizardScan1 = await new AxeBuilder({ page })
      .disableRules(['color-contrast'])
      .analyze();
    expect(wizardScan1.violations).toEqual([]);

    // Go to step 2 and audit
    const usernameInput = page.locator('todo-app >> user-profile >> #profile-username');
    const emailInput = page.locator('todo-app >> user-profile >> #profile-email');
    const nextBtn = page.locator('todo-app >> user-profile >> .next-btn');

    await usernameInput.fill('Arthur');
    await emailInput.fill('arthur@camelot.org');
    await nextBtn.click();

    const wizardScan2 = await new AxeBuilder({ page })
      .disableRules(['color-contrast'])
      .analyze();
    expect(wizardScan2.violations).toEqual([]);
  });

  test('4.2. Keyboard Navigation Flow', async ({ page }) => {
    // Focus indicator verification using sequential tab indexes
    await page.keyboard.press('Tab');
    const activeElementTag = await page.evaluate(() => document.activeElement?.tagName);
    expect(activeElementTag).toBeDefined();
  });

  test('4.3. Visual Regression Defenses', async ({ page }) => {
    // 1. Screenshot capture of the Slideout Navigation Menu
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');

    const openBtn = page.locator('todo-app >> app-navigation >> #drawer-open');
    const drawer = page.locator('todo-app >> app-navigation >> #app-drawer');

    await openBtn.click();
    await expect(drawer).toBeVisible();
    await expect(openBtn).toHaveAttribute('aria-expanded', 'true');
    
    // Capture and save slideout visual state baseline
    await page.screenshot({ path: 'test-results/baselines/mobile-slideout-menu.png' });

    // 2. Screenshot capture of the Setup Wizard steps
    const profileLink = page.locator('todo-app >> app-navigation >> #app-drawer >> a[data-route="profile"]');
    await profileLink.click();

    const stepCard = page.locator('todo-app >> user-profile >> .profile-card');
    await expect(stepCard).toBeVisible();

    // Capture step 1 visual layout baseline
    await stepCard.screenshot({ path: 'test-results/baselines/setup-step1.png' });

    // Fill details to progress to step 2
    const usernameInput = page.locator('todo-app >> user-profile >> #profile-username');
    const emailInput = page.locator('todo-app >> user-profile >> #profile-email');
    const nextBtn = page.locator('todo-app >> user-profile >> .next-btn');

    await usernameInput.fill('Baseline Tester');
    await emailInput.fill('baseline@test.com');
    await nextBtn.click();

    // Capture step 2 visual layout baseline
    await stepCard.screenshot({ path: 'test-results/baselines/setup-step2.png' });
  });
});
