let currentWindowId = null;

document.addEventListener('DOMContentLoaded', async () => {
  currentWindowId = (await chrome.windows.getCurrent()).id;
  loadWindowList();
  updateAddButtonVisibility();

  document.getElementById('addWindow').addEventListener('click', addNewWindow);

  // Enhanced debug info with better formatting
  console.log('%cTab Window Manager', 'color: #2563eb; font-weight: bold; font-size: 16px');


  console.log('%cRun this to get fresh data:', 'font-style: italic; color: #666');

  // Create a clickable debug command
  console.log('%c chrome.runtime.sendMessage({action: "listTabGroups"}); ',
    'background: #f3f4f6; color: #2563eb; padding: 4px 8px; border-radius: 4px; ' +
    'font-family: monospace; cursor: pointer; border: 1px solid #e5e7eb;');

  // Send message to background script for debug info
  chrome.runtime.sendMessage({action: 'listTabGroups'});
});

async function updateAddButtonVisibility() {
  const storage = await chrome.storage.local.get('windows');
  const windows = storage.windows || [];
  const isCurrentWindowSaved = windows.some(w => w.currentId === currentWindowId);

  const addButton = document.getElementById('addWindow');
  addButton.style.display = isCurrentWindowSaved ? 'none' : 'block';
}

async function addNewWindow() {
  const window = await chrome.windows.getCurrent({ populate: true });
  const tabs = window.tabs.map(tab => ({
    url: tab.url,
    title: tab.title,
    pinned: tab.pinned // Make sure to save pinned status
  }));

  const windowData = {
    id: crypto.randomUUID(),
    currentId: window.id,
    name: '',
    tabs,
    timestamp: Date.now()
  };

  const storage = await chrome.storage.local.get('windows');
  const windows = storage.windows || [];
  windows.push(windowData);

  await chrome.storage.local.set({ windows });
  await loadWindowList();
  await updateAddButtonVisibility();

  // Find and focus the new window's name input
  const newItem = document.querySelector(`[data-id="${windowData.id}"]`);
  const nameInput = newItem.querySelector('.name-input');
  nameInput.classList.add('editing');
  nameInput.focus();
}

async function loadWindowList() {
  const storage = await chrome.storage.local.get('windows');
  const windows = storage.windows || [];
  const windowList = document.getElementById('windowList');

  // Get all current window IDs
  const existingWindows = await chrome.windows.getAll();
  const existingIds = existingWindows.map(w => w.id);

  // Sort windows by timestamp (newest first)
  const sortedWindows = [...windows].sort((a, b) => b.timestamp - a.timestamp);

  windowList.innerHTML = sortedWindows.map(window => {
    const isCurrentWindow = window.currentId === currentWindowId;
    const isOpen = existingIds.includes(window.currentId);

    return `
      <div class="window-item ${isCurrentWindow ? 'current' : ''} ${isOpen ? 'open' : ''}" data-id="${window.id}">
        <div class="window-info">
          <div class="status-wrapper">
            <div class="status-indicator" title="${isCurrentWindow ? 'Current Window' : (isOpen ? 'Window Open' : 'Window Closed')}"></div>
            ${isOpen ? `
              <button class="icon-button close-window" title="Close window">
                <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="24" y1="0" x2="0" y2="24"></line>
                  <line x1="0" y1="0" x2="24" y2="24"></line>
                </svg>
              </button>
            ` : ''}
          </div>
          <span class="window-name ${!window.name ? 'hidden' : ''}">${window.name}</span>
          <input type="text" class="name-input ${!window.name ? 'editing' : ''}"
                 value="${window.name}"
                 placeholder="Enter window name">
          <span class="tab-count">(${window.tabs.length} tabs)</span>
        </div>
        <div class="actions">
          <button class="icon-button edit" title="Edit name">
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="icon-button delete" title="Delete window">
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 6h18"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              <line x1="10" y1="11" x2="10" y2="17"/>
              <line x1="14" y1="11" x2="14" y2="17"/>
            </svg>
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Add click handlers for opening windows
  document.querySelectorAll('.window-item').forEach(item => {
    item.addEventListener('click', async (e) => {
      // Don't handle clicks on input or buttons
      if (e.target.classList.contains('name-input') ||
          e.target.closest('.icon-button')) {
        return;
      }

      const windowId = item.dataset.id;
      const storage = await chrome.storage.local.get('windows');
      const windowData = storage.windows.find(w => w.id === windowId);

      if (windowData) {
        try {
          // Check if window already exists
          const existingWindow = await chrome.windows.get(windowData.currentId);
          // Window exists, focus it
          await chrome.windows.update(windowData.currentId, { focused: true });
        } catch (error) {
          // Window doesn't exist, create new one using the background script function
          chrome.runtime.sendMessage(
            {
              action: 'createWindowWithPinnedTabs',
              tabs: windowData.tabs
            },
            (response) => {
              if (response && response.success) {
                // Update the currentId for the window
                const windows = storage.windows.map(w => {
                  if (w.id === windowId) {
                    return { ...w, currentId: response.windowId };
                  }
                  return w;
                });
                chrome.storage.local.set({ windows });
              } else {
                console.error('Failed to create window with pinned tabs:', response?.error);
              }
            }
          );
        }
      }
    });
  });

  // Add handlers for closing windows
  document.querySelectorAll('.close-window').forEach(button => {
    button.addEventListener('click', async (e) => {
      e.stopPropagation();
      const windowId = button.closest('.window-item').dataset.id;
      const storage = await chrome.storage.local.get('windows');
      const windowData = storage.windows.find(w => w.id === windowId);

      if (windowData) {
        try {
          await chrome.windows.remove(windowData.currentId);
          await loadWindowList();
        } catch (error) {
          console.error('Failed to close window:', error);
        }
      }
    });
  });

  // Add handlers for editing
  document.querySelectorAll('.edit').forEach(button => {
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = button.closest('.window-item');
      const nameInput = item.querySelector('.name-input');
      const windowName = item.querySelector('.window-name');

      nameInput.classList.add('editing');
      windowName.classList.add('hidden');
      nameInput.focus();
    });
  });

  // Add handlers for name inputs
  document.querySelectorAll('.name-input').forEach(input => {
    const handleSave = async () => {
      const windowId = input.closest('.window-item').dataset.id;
      const newName = input.value.trim();

      if (newName) {
        const storage = await chrome.storage.local.get('windows');
        const windows = storage.windows.map(w => {
          if (w.id === windowId) {
            return { ...w, name: newName };
          }
          return w;
        });

        await chrome.storage.local.set({ windows });
        input.classList.remove('editing');
        const windowName = input.closest('.window-item').querySelector('.window-name');
        windowName.classList.remove('hidden');
        await loadWindowList();
        await updateExtensionIcon(currentWindowId);
        await updateAddButtonVisibility();
      }
    };

    // Handle enter key
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        handleSave();
      }
    });

    // Handle blur (losing focus)
    input.addEventListener('blur', handleSave);
  });

  // Add handlers for deleting windows
  document.querySelectorAll('.delete').forEach(button => {
    button.addEventListener('click', async (e) => {
      e.stopPropagation();
      const windowId = button.closest('.window-item').dataset.id;
      const storage = await chrome.storage.local.get('windows');
      const windows = storage.windows.filter(w => w.id !== windowId);
      await chrome.storage.local.set({ windows });
      await loadWindowList();
      await updateExtensionIcon(currentWindowId);
      await updateAddButtonVisibility();
    });
  });
}

// Update extension icon based on window status
async function updateExtensionIcon(windowId) {
  const storage = await chrome.storage.local.get('windows');
  const windows = storage.windows || [];
  const isWindowSaved = windows.some(w => w.currentId === windowId && w.name);

  const svg = createIconSVG(isWindowSaved);
  const imageData = await svgToImageData(svg, 128);

  await chrome.action.setIcon({ imageData });
}

// Create SVG icon data
function createIconSVG(saved = false) {
  const color = saved ? '#2563eb' : '#9ca3af';
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <line x1="4" y1="9" x2="20" y2="9" />
      <line x1="8" y1="4" x2="8" y2="9" />
      <line x1="12" y1="4" x2="12" y2="9" />
      <line x1="16" y1="4" x2="16" y2="9" />
    </svg>
  `;
}

// Convert SVG to ImageData
async function svgToImageData(svgString, size) {
  const blob = new Blob([svgString], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const img = await createImageBitmap(await fetch(url).then(r => r.blob()));

  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, size, size);

  URL.revokeObjectURL(url);
  return ctx.getImageData(0, 0, size, size);
}
