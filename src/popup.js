import { bookmarkManager } from './manager.js';
import { HOME_PAGE } from './utils/constant.js';
import { get as i18nGet, replace as i18nReplace } from './utils/i18n.js';

const browser = chrome;

let isLoading = false;

function showLoading(text = '处理中...') {
  document.getElementById('loadingOverlay').classList.add('show');
  document.getElementById('loadingText').textContent = text;
  isLoading = true;
}

function hideLoading() {
  document.getElementById('loadingOverlay').classList.remove('show');
  isLoading = false;
}

async function handleAction(actionName) {
  if (isLoading) return;
  
  try {
    switch (actionName) {
      case 'pull':
        showLoading('正在拉取远程书签...');
        await bookmarkManager.pull();
        updateLastSyncTime();
        break;
      case 'push':
        showLoading('正在推送本地书签...');
        await bookmarkManager.push();
        updateLastSyncTime();
        break;
      case 'diff':
        showLoading('正在比较差异...');
        await bookmarkManager.showDiff();
        break;
      case 'clear-local':
        await bookmarkManager.clearLocal();
        break;
      case 'show-options':
        browser.runtime.openOptionsPage();
        break;
      case 'help':
        window.open(HOME_PAGE);
        break;
    }
  } catch (e) {
    console.error('Action failed:', e);
    alert(`操作失败: ${e.message || '未知错误'}`);
  } finally {
    hideLoading();
  }
}

function updateLastSyncTime() {
  const now = new Date();
  const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  document.getElementById('syncTime').textContent = `最后同步: ${timeStr}`;
  
  browser.storage.local.set({ lastSyncTime: now.getTime() });
}

async function loadLastSyncTime() {
  try {
    const data = await browser.storage.local.get(['lastSyncTime']);
    if (data.lastSyncTime) {
      const date = new Date(data.lastSyncTime);
      const timeStr = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
      document.getElementById('syncTime').textContent = `最后同步: ${timeStr}`;
    }
  } catch (e) {
    console.error('Failed to load sync time:', e);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  i18nReplace();
  loadLastSyncTime();
  
  document.addEventListener('click', (e) => {
    const target = e.target.closest('.menu-item');
    if (target && !target.classList.contains('disabled')) {
      const actionName = target.getAttribute('name');
      if (actionName) {
        handleAction(actionName);
      }
    }
  });
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('UNHANDLED PROMISE REJECTION:', e);
  hideLoading();
});