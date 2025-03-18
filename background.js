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
  }
}

// Convert SVG to ImageData
async function svgToImageData(svgString, size) {
  const blob = new Blob([svgString], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const img = await createImageBitmap(await fetch(url).then((r) => r.blob()));

  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, size, size);

  URL.revokeObjectURL(url);
  return ctx.getImageData(0, 0, size, size);
}

// Clean up invalid window references
async function cleanupWindows() {
  const storage = await chrome.storage.local.get('windows');
  const windows = storage.windows || [];

  // Get all current Chrome windows
  const currentWindows = await chrome.windows.getAll();
  const validWindowIds = new Set(currentWindows.map((w) => w.id));

  // Mark windows that no longer exist as closed
  const updatedWindows = windows.map((w) => {
    if (!validWindowIds.has(w.currentId)) {
      return {
        ...w,
        currentId: null, // Mark as closed
      };
    }
    return w;
  });

  await chrome.storage.local.set({ windows: updatedWindows });
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
      }));
      await chrome.storage.local.set({ windows });
    }
  } catch (error) {
    console.error('Failed to update window tabs:', error);
    await cleanupWindows();
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

// Run cleanup on extension startup
chrome.runtime.onStartup.addListener(cleanupWindows);

// Run cleanup when extension is installed or updated
chrome.runtime.onInstalled.addListener(cleanupWindows);
