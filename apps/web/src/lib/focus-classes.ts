/**
 * The project's `--focus` token as a keyboard-focus outline, for tabs and the links that open a
 * tab (`F3.73` critique fix). An outline, not a `ring`: a ring is a `box-shadow`, and the selected
 * tab's pressed `box-shadow` (`.surface-tab-selected`) competes with it.
 */
export const FOCUS_OUTLINE_CLASS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";
