// The page clock of first-view.mjs (#1815, reviews L-5 and L-e): a Date replacement fixed at one instant. `new Date()`
// and `Date.now()` give the fixed time, `Date(...)` called without `new` returns the string of the fixed time (as the
// real Date() returns the current time as a string), `new Date(x)` and the static methods behave as the real Date, and
// instances are real Date objects. The script text is injected with Playwright addInitScript before any page script.
export function clockScript(fixedMs) {
  if (!Number.isFinite(fixedMs)) throw new Error('fixed time must be a number of milliseconds');
  return `(() => {
  const F = ${fixedMs}; const D = Date;
  function FixedDate(...a) {
    if (!new.target) return new D(F).toString();
    return a.length ? new D(...a) : new D(F);
  }
  FixedDate.prototype = D.prototype;
  FixedDate.now = () => F; FixedDate.parse = D.parse; FixedDate.UTC = D.UTC;
  Object.defineProperty(FixedDate, 'name', {value: 'Date'});
  globalThis.Date = FixedDate;
})();`;
}
