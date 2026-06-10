/**
 * Runs a DOM update inside a native View Transition when the browser
 * supports it, falling back to a plain synchronous update otherwise.
 *
 * TypeScript's lib.dom now ships ViewTransition types, so no `any` casts
 * are needed. The promise rejections are swallowed inline: an aborted or
 * skipped transition (e.g. rapid successive calls) must not surface as an
 * unhandled rejection.
 */
export function withViewTransition(update: () => void): void {
  if (typeof document.startViewTransition !== 'function') {
    update();
    return;
  }

  try {
    const transition = document.startViewTransition(update);
    transition.updateCallbackDone.catch(() => {});
    transition.ready.catch(() => {});
    transition.finished.catch(() => {});
  } catch {
    // startViewTransition can throw synchronously in edge cases
    update();
  }
}
