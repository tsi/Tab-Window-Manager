// Update extension icon based on window status
async function updateExtensionIcon(windowId) {
  const storage = await chrome.storage.local.get('windows');
  const windows = storage.windows || [];
  const isWindowSaved = windows.some((w) => w.currentId === windowId && w.name);

  // Get the active tab in the window
  const [activeTab] = await chrome.tabs.query({ active: true, windowId });
  updateIcon(isWindowSaved, activeTab?.id);
}

function setIcon(image) {
  var data = {
    path: {},
  };

  for (let nr of [16, 32, 48, 128]) {
    data.path[nr] = `icons/${image}${nr}.png`;
  }

  chrome.action.setIcon(data, function () {
    var err = chrome.runtime.lastError;
    if (err) {
      console.error('Error in SetIcon: ' + err.message);
    }
  });
}

// Sets on/off badge, and for Chrome updates dark/light mode icon
function updateIcon(saved, tabId) {
  setIcon('icon');

  if (saved && tabId) {
    chrome.action.setBadgeText({ text: 'on', tabId });
    chrome.action.setBadgeBackgroundColor({ color: '#05e70d', tabId });
  } else if (tabId) {
    chrome.action.setBadgeText({ text: '', tabId });
    chrome.action.setBadgeBackgroundColor({ color: 'transparent', tabId });
  }
}

// Clean up and update window references
async function updateWindowReferences() {
  const storage = await chrome.storage.local.get('windows');
  const windows = storage.windows || [];

  // Get all current Chrome windows with their tabs
  const currentWindows = await chrome.windows.getAll({ populate: true });

  // Create a map of tab URLs to window IDs and pinned status
  const tabUrlMap = new Map();
  const pinnedTabs = new Map();

  currentWindows.forEach(window => {
    window.tabs.forEach(tab => {
      // Store both window ID and whether the tab is pinned
      tabUrlMap.set(tab.url, {
        windowId: window.id,
        pinned: tab.pinned
      });
    });
  });

  // Update window references based on matching tabs
  const updatedWindows = windows.map(savedWindow => {
    // Check if this saved window's tabs match any current window
    const matchingWindow = findBestMatchingWindow(savedWindow.tabs, tabUrlMap);

    if (matchingWindow) {
      // Update pinned status for matched tabs
      savedWindow.tabs = savedWindow.tabs.map(tab => ({
        ...tab,
        pinned: tabUrlMap.get(tab.url)?.pinned || false
      }));
    }

    return {
      ...savedWindow,
      currentId: matchingWindow?.windowId || null
    };
  });

  await chrome.storage.local.set({ windows: updatedWindows });

  // Update icons for all windows
  for (const window of currentWindows) {
    await updateExtensionIcon(window.id);
  }
}

// Find the best matching window based on tab URLs
function findBestMatchingWindow(savedTabs, tabUrlMap) {
  // Count how many tabs match for each window
  const windowMatches = new Map();

  savedTabs.forEach(savedTab => {
    const tabInfo = tabUrlMap.get(savedTab.url);
    if (tabInfo) {
      const count = windowMatches.get(tabInfo.windowId) || 0;
      windowMatches.set(tabInfo.windowId, count + 1);
    }
  });

  // Find the window with the most matching tabs
  let bestMatch = null;
  let maxMatches = 0;

  windowMatches.forEach((matches, windowId) => {
    // Require at least 50% of tabs to match
    if (matches >= savedTabs.length / 2 && matches > maxMatches) {
      maxMatches = matches;
      bestMatch = { windowId, matchCount: matches };
    }
  });

  return bestMatch;
}

// Update window references when tabs change
async function updateWindowTabs(windowId) {
  const storage = await chrome.storage.local.get('windows');
  const windows = storage.windows || [];

  try {
    const currentWindow = await chrome.windows.get(windowId, {
      populate: true,
    });
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

// Handle window removal
chrome.windows.onRemoved.addListener(async (windowId) => {
  const storage = await chrome.storage.local.get('windows');
  const windows = storage.windows || [];

  const updatedWindows = windows.map((w) => {
    if (w.currentId === windowId) {
      return {
        ...w,
        currentId: null, // Mark as closed
      };
    }
    return w;
  });

  await chrome.storage.local.set({ windows: updatedWindows });
});

// Update icon when active window changes
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    await updateExtensionIcon(windowId);
  }
});

// Handle tab updates
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    await updateWindowTabs(tab.windowId);
    await updateExtensionIcon(tab.windowId);
  }
});

// Handle tab moving between windows
chrome.tabs.onAttached.addListener(async (tabId, attachInfo) => {
  await updateWindowTabs(attachInfo.newWindowId);
  await updateExtensionIcon(attachInfo.newWindowId);
});

chrome.tabs.onDetached.addListener(async (tabId, detachInfo) => {
  await updateWindowTabs(detachInfo.oldWindowId);
  await updateExtensionIcon(detachInfo.oldWindowId);
});

// Helper function to wait for Chrome windows and tabs to initialize
async function waitForChromeInitialization(retries = 10, delay = 500) {
  for (let i = 0; i < retries; i++) {
    const windows = await chrome.windows.getAll({ populate: true });
    if (windows.length > 0) {
      console.log('Chrome windows and tabs initialized.');
      return; // Chrome is initialized
    }
    await new Promise((resolve) => setTimeout(resolve, delay)); // Wait before retrying
  }
  console.warn('Chrome windows and tabs did not initialize in time.');
}

// Helper function to initialize the extension
async function initializeExtension() {
  try {
    await waitForChromeInitialization(); // Ensure Chrome is fully initialized
    await updateWindowReferences();
  } catch (error) {
    console.error('Failed to initialize extension:', error);
  }
}

// Combine startup and installation listeners
chrome.runtime.onStartup.addListener(initializeExtension);
chrome.runtime.onInstalled.addListener(initializeExtension);
