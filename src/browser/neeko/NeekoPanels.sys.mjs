/**
 * Where Firefox's own panels appear in a window with a custom UI.
 *
 * Firefox hangs its panels from icons in its toolbars: permission prompts
 * (camera, microphone, location, notifications), password saving and add-on
 * installs from the address bar, notices like "add-on added" from the menu
 * button. Neeko hides those toolbars, so Firefox would open these panels in
 * the window's top-left corner. Instead they hang from the top edge of the
 * web page: the address bar's panels at its left end and the toolbar
 * buttons' at its right end, as in Firefox.
 *
 * This is the fallback for UIs that don't show these things themselves.
 */

const HTML_NS = "http://www.w3.org/1999/xhtml";

// An invisible line along the top of the web page, a little inside it, for
// the panels to hang from. neeko.css keeps it there, wherever the UI puts
// the page, and across the screen in fullscreen.
const ANCHOR_ID = "neeko-panel-anchor";

/**
 * Whether a panel's own anchor is one of the toolbar buttons after the
 * address bar (the menu, extensions), whose panels Firefox lines up on the
 * right. Everything else lines up on the left, like the address bar's.
 */
function isToolbarButton(doc, anchor) {
  let addressBar = doc.getElementById("urlbar-container");
  if (
    !anchor?.closest("#nav-bar") ||
    !addressBar ||
    addressBar.contains(anchor)
  ) {
    return false;
  }
  let position = addressBar.compareDocumentPosition(anchor);
  return !!(position & anchor.DOCUMENT_POSITION_FOLLOWING);
}

/**
 * Runs just before one of Firefox's panels appears. If the anchor Firefox
 * picked is hidden along with its toolbar, the panel hangs from the page
 * instead. Permission prompts find no visible anchor at all and open with
 * none, so they move too.
 */
function onPopupShowing(doc, event) {
  let panel = event.target;
  if (panel.localName != "panel") {
    return;
  }
  let anchor = panel.anchorNode;
  let hidden = anchor
    ? !anchor.checkVisibility()
    : panel.id == "notification-popup";
  if (hidden) {
    panel.moveToAnchor(
      doc.getElementById(ANCHOR_ID),
      isToolbarButton(doc, anchor) ? "after_end" : "after_start"
    );
  }
}

export const NeekoPanels = {
  /**
   * Called by NeekoWindow for each browser window that shows a custom UI.
   *
   * @param {Window} win
   */
  init(win) {
    let doc = win.document;
    let anchor = doc.createElementNS(HTML_NS, "div");
    anchor.id = ANCHOR_ID;
    // After the page area, which CSS anchor positioning requires.
    doc.body.append(anchor);
    doc.addEventListener("popupshowing", event => onPopupShowing(doc, event), {
      capture: true,
    });
  },
};
