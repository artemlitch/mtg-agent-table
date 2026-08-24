// Only fields take focus. Nothing else on the table does.
//
// This is a table you point at, not a form you tab through. A focus ring
// travelling around fifty buttons answers a question nobody asked, and a
// focused button is worse than useless here: it silently claims Enter and
// Space, which are the two keys the table itself uses. Enter reaching for the
// chat would instead re-press whatever button was last clicked.
//
// Doing it per element is the same trap as the mana braces — fifty call sites
// and the fifty-first forgets. So it is done once, to the document, and kept
// true as React mounts and unmounts things.
//
// Two halves, because there are two ways in:
//   Tab      — answered by tabindex="-1" on everything that is not a field.
//   A click  — answered by refusing the mousedown's default on those same
//              elements. Chrome on macOS mostly does not focus a clicked
//              button anyway, but "mostly" is not a rule.

/** Keeps the caret: things you type into. */
const FIELDS = "input, textarea, select, [contenteditable]";

/** Everything the browser would otherwise put in the tab order. */
const FOCUSABLE = `button, a[href], area[href], summary, [tabindex]:not([tabindex="-1"])`;

const strip = (el: Element) => {
  if (el.matches(FIELDS)) return;
  if (el.getAttribute("tabindex") !== "-1") el.setAttribute("tabindex", "-1");
};

const stripAll = (root: Element | Document) => {
  if (root instanceof Element) strip(root);
  for (const el of root.querySelectorAll(FOCUSABLE)) strip(el);
};

export function fieldsOnlyFocus(): () => void {
  stripAll(document);

  // childList only, deliberately: writing the attribute is itself a mutation,
  // and observing attributes here would be a loop feeding itself. React
  // patches an existing node rather than replacing it on most re-renders, and
  // it does not manage tabindex, so what we set stays set.
  const mo = new MutationObserver((records) => {
    for (const r of records) {
      for (const n of r.addedNodes) if (n.nodeType === Node.ELEMENT_NODE) stripAll(n as Element);
    }
  });
  mo.observe(document.body, { subtree: true, childList: true });

  // A click must not focus what it presses. Only the default is refused — the
  // click itself still fires, and a drag on the felt or a selection in the
  // chat is untouched, because neither starts on one of these.
  const onDown = (e: MouseEvent) => {
    const el = (e.target as Element | null)?.closest?.(FOCUSABLE);
    if (el && !el.matches(FIELDS)) e.preventDefault();
  };
  document.addEventListener("mousedown", onDown);

  return () => {
    mo.disconnect();
    document.removeEventListener("mousedown", onDown);
  };
}
