/**
 * Neeko's names for Firefox's menus and their items, which an app lists in
 * browser.json's "menus" to keep them (NeekoMenus hides the rest). Each name
 * stands for one or more of Firefox's element ids; after a Firefox update,
 * check them against browser-menubar.inc.xhtml and browser-context.inc.xhtml
 * (docs/lessons.md). Firefox items that have no name here are hidden
 * wherever an app trims a menu, so new ones don't appear unasked.
 *
 * Plain data: tools/app.ts reads this file too, to check an app's names.
 */

// The menu bar. Each menu: Firefox's <menu> id, its popup's id, and its
// items by name. A menu without items can only be kept whole: its contents
// are Firefox's own lists (history, bookmarks, windows).
export const MENUBAR = {
  file: {
    menu: "file-menu",
    popup: "menu_FilePopup",
    items: {
      newTab: ["menu_newNavigatorTab"],
      newContainerTab: ["menu_newUserContext"],
      newWindow: ["menu_newNavigator"],
      newPrivateWindow: ["menu_newPrivateWindow"],
      openLocation: ["menu_openLocation"],
      openFile: ["menu_openFile"],
      closeTab: ["menu_close"],
      closeWindow: ["menu_closeWindow"],
      savePage: ["menu_savePage"],
      emailLink: ["menu_sendLink"],
      pageSetup: ["menu_printSetup"],
      print: ["menu_print"],
      import: ["menu_importFromAnotherBrowser"],
      workOffline: ["goOfflineMenuitem"],
    },
  },
  edit: {
    menu: "edit-menu",
    popup: "menu_EditPopup",
    items: {
      undo: ["menu_undo"],
      redo: ["menu_redo"],
      cut: ["menu_cut"],
      copy: ["menu_copy"],
      paste: ["menu_paste"],
      delete: ["menu_delete"],
      selectAll: ["menu_selectAll"],
      find: ["menu_find"],
      findAgain: ["menu_findAgain"],
      textDirection: ["textfieldDirection-swap"],
    },
  },
  view: {
    menu: "view-menu",
    popup: "menu_viewPopup",
    items: {
      toolbars: ["viewToolbarsMenu"],
      sidebar: ["viewSidebarMenuMenu"],
      zoom: ["viewFullZoomMenu"],
      pageStyle: ["pageStyleMenu"],
      repairTextEncoding: ["repair-text-encoding"],
      fullScreen: ["enterFullScreenItem", "exitFullScreenItem", "fullScreenItem"],
      readerView: ["menu_readerModeItem"],
      allTabs: ["menu_showAllTabs"],
      pageDirection: ["documentDirection-swap"],
    },
  },
  history: { menu: "history-menu" },
  bookmarks: { menu: "bookmarksMenu" },
  profiles: { menu: "profiles-menu" },
  tools: {
    menu: "tools-menu",
    popup: "menu_ToolsPopup",
    items: {
      downloads: ["menu_openDownloads"],
      addons: ["menu_openAddons"],
      sync: [
        "sync-setup",
        "sync-enable",
        "sync-unverifieditem",
        "sync-syncnowitem",
        "sync-reauthitem",
      ],
      firefoxView: ["menu_openFirefoxView"],
      editPDF: ["menu_editPDF"],
      browserTools: ["browserToolsMenu"],
      pageInfo: ["menu_pageInfo"],
    },
  },
  window: { menu: "windowMenu" },
  help: {
    menu: "helpMenu",
    popup: "menu_HelpPopup",
    items: {
      help: ["menu_openHelp"],
      reportBrokenSite: ["help_reportBrokenSite"],
      feedback: ["feedbackPage"],
      troubleshootMode: ["helpSafeMode"],
      troubleshootingInfo: ["troubleShooting"],
      reportDeceptiveSite: [
        "menu_HelpPopup_reportPhishingtoolmenu",
        "menu_HelpPopup_reportPhishingErrortoolmenu",
      ],
      switchDevice: ["helpSwitchDevice"],
      policySupport: ["helpPolicySupport"],
    },
  },
};

// Menu bar items Neeko never hides, whatever the app keeps: on macOS they
// make up the application menu (About, Settings, Services, Hide, Quit),
// which nsMenuBarX builds from them where they sit in Firefox's menus, and
// elsewhere Settings and Quit stay reachable.
export const MENUBAR_ALWAYS = [
  "aboutName",
  "menu_preferences",
  "menu_settings",
  "menu_setAsDefault",
  "menu_referralsPage",
  "menu_mac_services",
  "menu_mac_hide_app",
  "menu_mac_hide_others",
  "menu_mac_show_all",
  "menu_mac_touch_bar",
  "menu_FileQuitItem",
];

// The page's context menu, by name. Firefox shows the ones that fit what
// was clicked (a link, an image, a text field, a selection...); an app's
// list only takes away. "extensions" is every item extensions add.
export const CONTEXT = {
  // The page
  back: ["context-back"],
  forward: ["context-forward"],
  reload: ["context-reload"],
  stop: ["context-stop"],
  bookmarkPage: ["context-bookmarkpage"],
  savePage: ["context-savepage"],
  selectAll: ["context-selectall"],
  takeScreenshot: ["context-take-screenshot"],
  sendPageToDevice: ["context-sendpagetodevice"],
  viewSource: ["context-viewsource"],
  inspect: ["context-inspect"],
  inspectAccessibility: ["context-inspect-a11y"],
  pageDirection: ["context-bidi-page-direction-toggle"],
  drmLearnMore: ["context-media-eme-learnmore"],
  // Links
  openLinkInCurrentTab: ["context-openlinkincurrent"],
  openLinkInTab: ["context-openlinkintab"],
  openLinkInContainerTab: [
    "context-openlinkincontainertab",
    "context-openlinkinusercontext-menu",
  ],
  openLinkInSplitView: ["context-openlinkinsplitview"],
  openLinkInWindow: ["context-openlink"],
  openLinkInPrivateWindow: ["context-openlinkprivate"],
  openLinkInSmartWindow: ["context-openlinksmartwindow"],
  previewLink: ["context-previewlink"],
  bookmarkLink: ["context-bookmarklink"],
  saveLink: ["context-savelink"],
  copyLink: ["context-copylink"],
  copyCleanLink: ["context-stripOnShareLink"],
  copyEmail: ["context-copyemail"],
  copyPhone: ["context-copyphone"],
  sendLinkToDevice: ["context-sendlinktodevice"],
  // Images, video and audio
  openImage: ["context-viewimage"],
  reloadImage: ["context-reloadimage"],
  saveImage: ["context-saveimage"],
  copyImage: ["context-copyimage-contents"],
  copyImageLink: ["context-copyimage"],
  emailImage: ["context-sendimage"],
  copyTextFromImage: ["context-imagetext"],
  imageInfo: ["context-viewimageinfo"],
  imageDescription: ["context-viewimagedesc"],
  visualSearch: ["context-visual-search"],
  setAsDesktopBackground: ["context-setDesktopBackground"],
  play: ["context-media-play"],
  pause: ["context-media-pause"],
  mute: ["context-media-mute"],
  unmute: ["context-media-unmute"],
  playbackSpeed: ["context-media-playbackrate"],
  loop: ["context-media-loop"],
  fullScreen: ["context-video-fullscreen", "context-leave-dom-fullscreen"],
  controls: ["context-media-showcontrols", "context-media-hidecontrols"],
  openVideo: ["context-viewvideo"],
  pictureInPicture: ["context-video-pictureinpicture"],
  saveVideoFrame: ["context-video-saveimage"],
  saveVideo: ["context-savevideo"],
  saveAudio: ["context-saveaudio"],
  copyVideoLink: ["context-copyvideourl"],
  copyAudioLink: ["context-copyaudiourl"],
  emailVideo: ["context-sendvideo"],
  emailAudio: ["context-sendaudio"],
  // Text fields and selections
  undo: ["context-undo"],
  redo: ["context-redo"],
  cut: ["context-cut"],
  copy: ["context-copy"],
  paste: ["context-paste"],
  pasteWithoutFormatting: ["context-paste-no-formatting"],
  delete: ["context-delete"],
  revealPassword: ["context-reveal-password"],
  textDirection: ["context-bidi-text-direction-toggle"],
  searchSelection: ["context-searchselect"],
  searchSelectionPrivate: ["context-searchselect-private"],
  translateSelection: ["context-translate-selection"],
  printSelection: ["context-print-selection"],
  viewSelectionSource: ["context-viewpartialsource-selection"],
  linkToHighlight: [
    "context-copy-link-to-highlight",
    "context-copy-clean-link-to-highlight",
    "context-remove-highlight",
  ],
  addSearchEngine: ["context-add-engine"],
  askAIChatbot: ["context-ask-chat"],
  // Groups
  spelling: [
    "spell-no-suggestions",
    "spell-add-to-dictionary",
    "spell-undo-add-to-dictionary",
    "spell-check-enabled",
    "spell-add-dictionaries-main",
    "spell-dictionaries",
    "spell-add-dictionaries",
  ],
  passwords: [
    "fill-login",
    "fill-login-generated-password",
    "use-relay-mask",
    "manage-saved-logins",
  ],
  frame: ["frame"],
  pdf: [
    "context-pdfjs-comment-selection",
    "context-pdfjs-highlight-selection",
    "context-pdfjs-undo",
    "context-pdfjs-redo",
    "context-pdfjs-cut",
    "context-pdfjs-copy",
    "context-pdfjs-paste",
    "context-pdfjs-delete",
    "context-pdfjs-select-all",
    "context-pdfjs-copy-page",
    "context-pdfjs-cut-page",
    "context-pdfjs-delete-page",
    "context-pdfjs-save-page",
  ],
  viewSourceCommands: [
    "context-viewsource-goToLine",
    "context-viewsource-wrapLongLines",
    "context-viewsource-highlightSyntax",
  ],
  extensions: [],
};
