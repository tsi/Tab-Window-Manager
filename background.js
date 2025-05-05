// Update extension icon based on window status
async function updateExtensionIcon(windowId) {
  const storage = await chrome.storage.local.get('windows');
  const windows = storage.windows || [];
  const isWindowSaved = windows.some((w) => w.currentId === windowId && w.name);

  setIconAndBadge('icon', isWindowSaved);
}

// Combined icon and badge setting function
function setIconAndBadge(image, saved) {
  const data = { path: {} };

  for (let nr of [16, 32, 48, 128]) {
    data.path[nr] = `icons/${image}${nr}.png`;
  }

  chrome.action.setIcon(data, () => {
    const err = chrome.runtime.lastError;
    if (err) console.error('Error in SetIcon:', err.message);
  });

  chrome.action.setBadgeText({ text: saved ? 'on' : '' });
  chrome.action.setBadgeBackgroundColor({ color: saved ? '#05e70d' : 'transparent' });
}

// Normalize URL for better matching
function normalizeUrl(url) {
  try {
    // Skip about:, chrome:, file: and other special URLs
    if (!url.startsWith('http')) return url;

    const urlObj = new URL(url);
    // Return just the origin and pathname (no query params, hash, etc)
    return urlObj.origin + urlObj.pathname;
  } catch (e) {
    console.warn('Failed to normalize URL:', url);
    return url;
  }
}

// Clean up and update window references
async function updateWindowReferences() {
  const storage = await chrome.storage.local.get('windows');
  const windows = storage.windows || [];
  const currentWindows = await chrome.windows.getAll({ populate: true });

  // Create a map of normalized tab URLs to window IDs and pinned status
  const tabUrlMap = new Map();

  currentWindows.forEach(window => {
    window.tabs.forEach(tab => {
      // Store both window ID and tab details with normalized URL
      tabUrlMap.set(normalizeUrl(tab.url), {
        windowId: window.id,
        pinned: tab.pinned,
        url: tab.url,
        title: tab.title
      });
    });
  });

  // Update window references based on matching tabs
  const updatedWindows = windows.map(savedWindow => {
    const matchingWindow = findBestMatchingWindow(savedWindow.tabs, tabUrlMap);

    if (matchingWindow) {
      // Update with fresh tab data but keep original ordering where possible
      savedWindow.tabs = savedWindow.tabs.map(tab => {
        const normalizedUrl = normalizeUrl(tab.url);
        const freshTab = tabUrlMap.get(normalizedUrl);
        return freshTab ? {
          url: freshTab.url,
          title: freshTab.title,
          pinned: freshTab.pinned || tab.pinned || false // Ensure pinned status is preserved
        } : tab;
      });
    }

    return {
      ...savedWindow,
      currentId: matchingWindow?.windowId || null,
      lastUpdated: Date.now()
    };
  });

  await chrome.storage.local.set({ windows: updatedWindows });

  // Update icons for all windows
  currentWindows.forEach(window => updateExtensionIcon(window.id));
}

// Simplified window matching algorithm with normalized URLs
function findBestMatchingWindow(savedTabs, tabUrlMap) {
  const windowMatches = new Map();

  // Count matches for each window using normalized URLs
  savedTabs.forEach(savedTab => {
    const normalizedUrl = normalizeUrl(savedTab.url);
    const tabInfo = tabUrlMap.get(normalizedUrl);

    if (tabInfo) {
      const windowId = tabInfo.windowId;
      windowMatches.set(windowId, (windowMatches.get(windowId) || 0) + 1);
    }
  });

  // Find the window with the most matching tabs
  let bestMatch = null;
  let maxMatches = 0;
  const threshold = Math.max(1, savedTabs.length * 0.3); // Lower threshold to 30%

  windowMatches.forEach((matches, windowId) => {
    if (matches >= threshold && matches > maxMatches) {
      maxMatches = matches;
      bestMatch = { windowId, matchCount: matches };
    }
  });

  return bestMatch;
}

// Make the debug function available to the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'listTabGroups') {
    listTabGroups();
    return true; // Required for async response
  }

  // Handle creating a window with pinned tabs
  if (message.action === 'createWindowWithPinnedTabs') {
    createWindowWithPinnedTabs(message.tabs)
      .then(newWindow => {
        sendResponse({success: true, windowId: newWindow.id});
      })
      .catch(error => {
        console.error('Error creating window with pinned tabs:', error);
        sendResponse({success: false, error: error.message});
      });
    return true; // Required for async response
  }
});

// List the current tab groups for debugging purposes
async function listTabGroups() {
  const {windows = []} = await chrome.storage.local.get('windows');
  console.log(windows);
  return windows;
}

// Update window references when tabs change
async function updateWindowTabs(windowId) {
  const storage = await chrome.storage.local.get('windows');
  const windows = storage.windows || [];

  try {
    const currentWindow = await chrome.windows.get(windowId, { populate: true });
    const windowIndex = windows.findIndex((w) => w.currentId === windowId);

    if (windowIndex !== -1) {
      windows[windowIndex].tabs = currentWindow.tabs.map((tab) => ({
        url: tab.url,
        title: tab.title,
        pinned: tab.pinned
      }));
      await chrome.storage.local.set({ windows });
    }
  } catch (error) {
    console.error('Failed to update window tabs:', error);
    await updateWindowReferences();
  }
}

// For popup.js - Create window with pinned tabs properly set
async function createWindowWithPinnedTabs(tabs) {
  const pinnedTabs = tabs.filter(tab => tab.pinned);
  const nonPinnedTabs = tabs.filter(tab => !tab.pinned);

  // Create window with first non-pinned tab or empty if all tabs are pinned
  const newWindow = await chrome.windows.create({
    url: nonPinnedTabs.length > 0 ? nonPinnedTabs[0].url : undefined,
    focused: true
  });

  // First create all pinned tabs
  for (const tab of pinnedTabs) {
    await chrome.tabs.create({
      url: tab.url,
      pinned: true,
      windowId: newWindow.id
    });
  }

  // Then create remaining non-pinned tabs (skip the first one if it exists)
  for (let i = 1; i < nonPinnedTabs.length; i++) {
    await chrome.tabs.create({
      url: nonPinnedTabs[i].url,
      pinned: false,
      windowId: newWindow.id
    });
  }

  return newWindow;
}

// Handles various window/tab events with debouncing
const pendingUpdates = new Map();
function scheduleUpdate(windowId, operation) {
  clearTimeout(pendingUpdates.get(windowId));
  pendingUpdates.set(windowId, setTimeout(async () => {
    await operation(windowId);
    pendingUpdates.delete(windowId);
  }, 300));
}

// Event handlers
chrome.windows.onRemoved.addListener(async (windowId) => {
  const storage = await chrome.storage.local.get('windows');
  const windows = storage.windows || [];

  const updatedWindows = windows.map((w) =>
    w.currentId === windowId ? {...w, currentId: null} : w);

  await chrome.storage.local.set({ windows: updatedWindows });
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    scheduleUpdate(windowId, updateExtensionIcon);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    scheduleUpdate(tab.windowId, async (windowId) => {
      await updateWindowTabs(windowId);
      await updateExtensionIcon(windowId);
    });
  }
});

// Handle tab moving between windows
function handleTabWindowChange(windowId) {
  scheduleUpdate(windowId, async (windowId) => {
    await updateWindowTabs(windowId);
    await updateExtensionIcon(windowId);
  });
}

chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
  handleTabWindowChange(attachInfo.newWindowId);
});

chrome.tabs.onDetached.addListener((tabId, detachInfo) => {
  handleTabWindowChange(detachInfo.oldWindowId);
});

// Run cleanup and update references on extension startup and installation
chrome.runtime.onStartup.addListener(() => {
  console.log('Extension starting up, updating window references...');
  // Give the browser a moment to restore tabs before matching
  setTimeout(updateWindowReferences, 3000);
});

// Run when extension is installed or updated
chrome.runtime.onInstalled.addListener(updateWindowReferences);
