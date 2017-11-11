const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/AddonManager.jsm");
Cu.import("resource://gre/modules/Preferences.jsm");
Cu.import("resource://gre/modules/Log.jsm");

XPCOMUtils.defineLazyServiceGetter(this, "AlertsService", "@mozilla.org/alerts-service;1", "nsIAlertsService");

const INDEX_HTML = "chrome://aboutsync/content/index.html";

const PREF_VERBOSE = "extensions.aboutsync.verbose";
let verbose = false;

function log(...args) {
  console.log(" *** aboutsync: ", ...args);
}

function debug(...args) {
  if (verbose) {
    console.log(" ***** aboutsync: ", ...args);
  }
}

// Utilities to initialize the addon...
function loadIntoWindow(window) {
  if (!window)
    return;
  let wintype = window.document.documentElement.getAttribute('windowtype');
  if (wintype != "navigator:browser") {
    log("not installing aboutsync extension into window of type " + wintype);
    return;
  }
  // Add persistent UI elements to the "Tools" ment.
  let menuItem = window.document.createElement("menuitem");
  menuItem.setAttribute("id", "aboutsync-menuitem");
  menuItem.setAttribute("label", "About Sync");
  menuItem.addEventListener("command", function(event) {
    let win = event.target.ownerDocument.defaultView;
    let tab = win.gBrowser.addTab(INDEX_HTML, { forceNotRemote: true });
    win.gBrowser.selectedTab = tab;
  }, true);
  let menu = window.document.getElementById("menu_ToolsPopup");
  if (!menu) {
    // might be a popup or similar.
    log("not installing aboutsync extension into browser window as there is no Tools menu");
  }
  menu.appendChild(menuItem);
  debug("installing aboutsync into new window");
}

function unloadFromWindow(window) {
  if (!window)
    return;
  window.document.getElementById("aboutsync-menuitem").remove();
  // Remove any persistent UI elements
  // Perform any other cleanup
}

let windowListener = {
  onOpenWindow: function(aWindow) {
    // Wait for the window to finish loading
    let domWindow = aWindow.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindowInternal || Ci.nsIDOMWindow);
    domWindow.addEventListener("load", function onLoad() {
      domWindow.removeEventListener("load", onLoad, false);
      loadIntoWindow(domWindow);
    }, false);
  },

  onCloseWindow: function(aWindow) {},
  onWindowTitleChange: function(aWindow, aTitle) {}
};

const ENGINE_NAMES = ["addons", "bookmarks", "clients", "forms", "history",
                      "passwords", "prefs", "tabs"];

function prefObserver(subject, topic, data) {
  debug("saw preference", data, "change");
  if (data == PREF_VERBOSE) {
    try {
      verbose = Services.prefs.getBoolPref(PREF_VERBOSE);
    } catch (ex) {}
  } else if (data.startsWith("services.sync.log.logger.engine.")) {
    // This should really be built into sync itself :(
    let engineName = data.split(".").pop();
    let logName = "Sync.Engine." + engineName.charAt(0).toUpperCase() + engineName.slice(1);;
    let levelString;
    try {
      levelString = Services.prefs.getCharPref(data);
    } catch (ex) {}
    if (levelString) {
      let level = Log.Level[levelString];
      Log.repository.getLogger(logName).level = level;
      log("Adjusted log", logName, "to level", levelString);
    }
  }
}

/* A facility for this addon to "persist" certain preferences across
   Sync resets.

   In general, these preferences are exposed in the addon's UI - but the
   preference must live here so that it works even when the addon's UI isn't
   open.
*/
const PREF_RESTORE_TOPICS = [
  "weave:service:start-over",
  "weave:service:start-over:finish",
];

const PREFS_TO_RESTORE = [
  "services.sync.log.appender.file.level",
  "services.sync.log.appender.dump",
  "services.sync.log.appender.file.logOnSuccess",
  "services.sync.log.appender.file.maxErrorAge",
  "services.sync.log.logger.engine.addons",
  "services.sync.log.logger.engine.apps",
  "services.sync.log.logger.engine.bookmarks",
  "services.sync.log.logger.engine.clients",
  "services.sync.log.logger.engine.forms",
  "services.sync.log.logger.engine.history",
  "services.sync.log.logger.engine.passwords",
  "services.sync.log.logger.engine.prefs",
  "services.sync.log.logger.engine.tabs",
];

let savedPrefs = null;
// The observer for the notifications Sync sends as it resets.
function startoverObserver(subject, topic, data) {
  if (!Preferences.get("extensions.aboutsync.applyOnStartOver")) {
    log("Sync is being reset, but aboutsync is not configured to restore prefs.");
    return;
  }
  switch (topic) {
    case "weave:service:start-over":
      // Sync is about to reset all its prefs - save them.
      log("Sync is starting over - saving pref values to restore");
      savedPrefs = {};
      for (let pref of PREFS_TO_RESTORE) {
        savedPrefs[pref] = Preferences.get(pref);
      }
      break;

    case "weave:service:start-over:finish":
      // Sync has completed resetting its world.
      log("Sync startover is complete - restoring pref values");
      for (let pref of Object.keys(savedPrefs)) {
        Preferences.set(pref, savedPrefs[pref]);
      }
      savedPrefs = null;
      break;

    default:
      log("unexpected topic", topic);
  }
}

// We'll show some UI on certain sync status notifications - currently just
// errors.
SYNC_STATUS_TOPICS = [
  "weave:ui:login:error",
  "weave:ui:sync:error",
];

function syncStatusObserver(subject, topic, data) {
  let clickCallback = (subject, topic, data) => {
    if (topic != "alertclickcallback")
      return;
    let win = Services.wm.getMostRecentWindow("navigator:browser");
    if (win) {
      win.switchToTabHavingURI("about:sync-log", true);
    } else {
      log("Failed to find a window to open the log url");
    }
  }
  let hide = Services.prefs.getBoolPref("extensions.aboutsync.hideNotifications", false);
  if (!hide) {
    let body = "about-sync noticed a sync failure - click here to view sync logs";
    AlertsService.showAlertNotification(null, "Sync Failed", body, true, null, clickCallback);
  }
}

const AboutSyncRedirector = {
  QueryInterface: XPCOMUtils.generateQI([Ci.nsIAboutModule]),
  classID: Components.ID("{decc7a05-f6c6-4624-9e58-176c84d032af}"),

  getURIFlags() {
    // Do we need others?
    return Ci.nsIAboutModule.ALLOW_SCRIPT;
  },

  newChannel(aURI, aLoadInfo) {
    let newURI = Services.io.newURI(INDEX_HTML);
    let channel = Services.io.newChannelFromURIWithLoadInfo(newURI, aLoadInfo);

    channel.originalURI = aURI;

    return channel;
  },

  createInstance(outer, iid) {
    if (outer) {
      throw Components.results.NS_ERROR_NO_AGGREGATION;
    }
    return this.QueryInterface(iid);
  },

  register() {
    const contract = "@mozilla.org/network/protocol/about;1?what=sync";
    const description = "About Sync";
    Components.manager.QueryInterface(Ci.nsIComponentRegistrar)
      .registerFactory(this.classID, description, contract, this);
  },

  unregister() {
    Components.manager.QueryInterface(Ci.nsIComponentRegistrar)
      .unregisterFactory(this.classID, this);
  }
};

/*
 * Extension entry points
 */
function startup(data, reason) {
  log("starting up");
  // Watch for prefs we care about.
  Services.prefs.addObserver(PREF_VERBOSE, prefObserver, false);
  // Ensure initial values are picked up.
  prefObserver(null, "", PREF_VERBOSE);
  for (let engine of ENGINE_NAMES) {
    let pref = "services.sync.log.logger.engine." + engine;
    Services.prefs.addObserver(pref, prefObserver, false);
  }
  // Setup our "pref restorer"
  for (let topic of PREF_RESTORE_TOPICS) {
    Services.obs.addObserver(startoverObserver, topic, false);
  }
  AboutSyncRedirector.register();

  // We'll display a notification on sync failure.
  for (let topic of SYNC_STATUS_TOPICS) {
    Services.obs.addObserver(syncStatusObserver, topic, false);
  }

  // Load into any existing windows
  let windows = Services.wm.getEnumerator("navigator:browser");
  while (windows.hasMoreElements()) {
    let domWindow = windows.getNext().QueryInterface(Ci.nsIDOMWindow);
    loadIntoWindow(domWindow);
  }

  // Load into any new windows
  Services.wm.addListener(windowListener);
}

function shutdown(data, reason) {
  // When the application is shutting down we normally don't have to clean
  // up any UI changes made
  if (reason == APP_SHUTDOWN)
    return;

  AboutSyncRedirector.unregister();

  let wm = Cc["@mozilla.org/appshell/window-mediator;1"].getService(Ci.nsIWindowMediator);

  // Stop listening for new windows
  wm.removeListener(windowListener);

  // Unload from any existing windows
  let windows = wm.getEnumerator("navigator:browser");
  while (windows.hasMoreElements()) {
    let domWindow = windows.getNext().QueryInterface(Ci.nsIDOMWindow);
    try {
      unloadFromWindow(domWindow);
    } catch (ex) {
      log("Failed to reset window: " + ex + "\n" + ex.stack);
    }
  }
  Services.prefs.removeObserver(PREF_VERBOSE, prefObserver);

  for (let topic of PREF_RESTORE_TOPICS) {
    Services.obs.removeObserver(startoverObserver, topic);
  }
  for (let topic of SYNC_STATUS_TOPICS) {
    Services.obs.removeObserver(syncStatusObserver, topic);
  }
}

function install(data, reason) {}
function uninstall(data, reason) {}
