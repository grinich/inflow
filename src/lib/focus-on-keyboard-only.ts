/**
 * Keep a mouse click from parking focus on a chrome button.
 *
 * The CSS already limits focus rings to `:focus-visible`, but that is not
 * enough on its own: Chrome re-evaluates the modality on every keypress, so a
 * button you CLICKED becomes keyboard-focused the moment you press a key — and
 * in an app driven by 1/2/3/J/K that is immediately. Clicking Unread and then
 * switching folders with a number left the ring sitting on Unread.
 *
 * Preventing the default on mousedown stops the button taking focus from the
 * pointer at all. Tab still focuses it, and Enter/Space still activate it with
 * the ring on — which is the case the ring is for.
 *
 * Spread onto a button: `<button {...keyboardFocusOnly} …>`.
 */
export const keyboardFocusOnly = {
  onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault(),
};
