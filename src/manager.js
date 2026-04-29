import gist from './utils/gist.js';
import { get as i18nGet } from './utils/i18n.js';
import bookmarkUtils from './utils/bookmark.js';
import { showNotification } from './utils/notification.js';
import { diffBookmarks, hasConflicts, hasChanges } from './utils/diff.js';
import { mergeBookmarks, autoMerge, MERGE_STRATEGIES } from './utils/merge.js';

const browser = chrome;

class BookmarkManager {
  async getLocalBookmark() {
    const bookmarks = await bookmarkUtils.getTree();
    return { bookmarks };
  }

  async getRemoteBookmark() {
    try {
      return await gist.fetch();
    } catch (e) {
      console.warn('Failed to get remote bookmark:', e);
      return null;
    }
  }

  async updateRemoteBookmark(bookmarks) {
    await gist.update(JSON.stringify(bookmarks, null, 2));
  }

  async getBookmarkBar(bookmarks) {
    if (!bookmarks || !bookmarks.bookmarks || bookmarks.bookmarks.length === 0) {
      return null;
    }
    return bookmarks.bookmarks[0].children[0];
  }

  isBookmarkAvailable(bm, msg) {
    const valid = Boolean(bm && bm.bookmarks && bm.bookmarks.length && bm.bookmarks[0].children.length);
    if (!valid && msg) showNotification(msg);
    return valid;
  }

  isEmpty(bm) {
    if (!this.isBookmarkAvailable(bm)) return true;
    const bookmark = bm && bm.bookmarks && bm.bookmarks.length && bm.bookmarks[0].children[0];
    return !(bookmark && bookmark.children && bookmark.children.length);
  }

  async clearBookmarks(bookmark) {
    if (!bookmark || !bookmark.children) return;
    await Promise.all(bookmark.children.map(node => bookmarkUtils.remove(node)));
  }

  async createBookmarks(bookmark, parentId) {
    if (!bookmark || !bookmark.children) return;
    await Promise.all(bookmark.children.map(node => bookmarkUtils.create(node, parentId)));
  }

  async showConflictResolver(diffResult, direction) {
    return new Promise((resolve) => {
      browser.storage.local.set({ diffResult, syncDirection: direction }).then(async () => {
        const tab = await browser.tabs.create({
          url: chrome.runtime.getURL('src/diff.html?direction=' + direction),
          active: true
        });
        
        const checkInterval = setInterval(() => {
          browser.tabs.get(tab.id, async (tabInfo) => {
            if (chrome.runtime.lastError || !tabInfo || tabInfo.url !== chrome.runtime.getURL('src/diff.html?direction=' + direction)) {
              clearInterval(checkInterval);
              const { resolutionMap, confirmed } = await browser.storage.local.get(['resolutionMap', 'confirmed']);
              await browser.storage.local.remove(['diffResult', 'syncDirection', 'resolutionMap', 'confirmed']);
              if (confirmed && resolutionMap) {
                resolve(resolutionMap);
              } else {
                resolve(null);
              }
            }
          });
        }, 200);
      });
    });
  }

  async showDiff() {
    try {
      showNotification('正在比较差异...');
      
      const local = await this.getLocalBookmark();
      const remote = await this.getRemoteBookmark();
      
      if (!this.isBookmarkAvailable(local)) {
        showNotification('本地书签为空');
        return;
      }
      
      if (!remote || !this.isBookmarkAvailable(remote)) {
        showNotification('远程书签为空');
        return;
      }
      
      const localBar = this.getBookmarkBar(local);
      const remoteBar = this.getBookmarkBar(remote);
      
      if (!localBar || !remoteBar) {
        showNotification('无法获取书签栏');
        return;
      }
      
      const diffResult = diffBookmarks(localBar.children || [], remoteBar.children || []);
      
      await browser.storage.local.set({ diffResult, syncDirection: 'view' });
      
      browser.tabs.create({
        url: chrome.runtime.getURL('src/diff.html?direction=view'),
        active: true
      });
    } catch (e) {
      console.error('showDiff failed:', e);
      showNotification('查看差异失败: ' + e.message);
    }
  }

  async syncFromRemote() {
    showNotification('正在拉取远程书签...');

    const remote = await this.getRemoteBookmark();
    if (!remote || !this.isBookmarkAvailable(remote)) {
      showNotification(i18nGet('REMOTE_BOOKMARK_EMPTY_TIP'));
      return;
    }

    const local = await this.getLocalBookmark();
    if (!this.isBookmarkAvailable(local)) {
      await this.performPull(remote);
      return;
    }

    const localBar = await this.getBookmarkBar(local);
    const remoteBar = await this.getBookmarkBar(remote);

    if (!remoteBar || !remoteBar.children) {
      await this.performPull(remote);
      return;
    }

    const diffResult = diffBookmarks(localBar.children, remoteBar.children);

    if (!hasChanges(diffResult)) {
      showNotification(i18nGet('NO_CHANGES'));
      return;
    }

    if (hasConflicts(diffResult)) {
      const resolutionMap = await this.showConflictResolver(diffResult, 'pull');
      if (!resolutionMap) {
        showNotification(i18nGet('SYNC_CANCELLED'));
        return;
      }
      await this.performPullWithMerge(remote, diffResult, resolutionMap);
    } else {
      await this.performPull(remote);
    }
  }

  async performPull(remote) {
    const local = await this.getLocalBookmark();
    const localBar = await this.getBookmarkBar(local);
    const remoteBar = await this.getBookmarkBar(remote);

    if (!localBar) {
      showNotification('无法获取本地书签栏');
      return;
    }

    await this.clearBookmarks(localBar);
    await this.createBookmarks(remoteBar, localBar.id);
    showNotification(i18nGet('SYNC_FROM_REMOTE_SUCCESS'));
  }

  async performPullWithMerge(remote, diffResult, resolutionMap) {
    const local = await this.getLocalBookmark();
    const localBar = await this.getBookmarkBar(local);
    const remoteBar = await this.getBookmarkBar(remote);

    if (!localBar) {
      showNotification('无法获取本地书签栏');
      return;
    }

    const merged = mergeBookmarks(diffBookmarks(localBar.children, remoteBar.children), resolutionMap);

    await this.clearBookmarks(localBar);
    await this.createBookmarks({ children: merged }, localBar.id);
    showNotification(i18nGet('SYNC_FROM_REMOTE_SUCCESS'));
  }

  async syncToRemote() {
    showNotification('正在推送本地书签...');

    const local = await this.getLocalBookmark();
    if (!this.isBookmarkAvailable(local)) {
      const confirm = window.confirm(i18nGet('local_empty_confirm'));
      if (!confirm) return;
    }

    let remote;
    try {
      remote = await this.getRemoteBookmark();
    } catch (e) {
      await this.updateRemoteBookmark(local);
      showNotification(i18nGet('SYNC_TO_REMOTE_SUCCESS'));
      return;
    }

    if (!remote || !this.isBookmarkAvailable(remote)) {
      await this.updateRemoteBookmark(local);
      showNotification(i18nGet('SYNC_TO_REMOTE_SUCCESS'));
      return;
    }

    const localBar = await this.getBookmarkBar(local);
    const remoteBar = await this.getBookmarkBar(remote);

    if (!remoteBar || !remoteBar.children) {
      await this.updateRemoteBookmark(local);
      showNotification(i18nGet('SYNC_TO_REMOTE_SUCCESS'));
      return;
    }

    const diffResult = diffBookmarks(localBar.children, remoteBar.children);

    if (!hasChanges(diffResult)) {
      showNotification(i18nGet('NO_CHANGES'));
      return;
    }

    if (hasConflicts(diffResult)) {
      const resolutionMap = await this.showConflictResolver(diffResult, 'push');
      if (!resolutionMap) {
        showNotification(i18nGet('SYNC_CANCELLED'));
        return;
      }
      await this.performPushWithMerge(local, diffResult, resolutionMap);
    } else {
      await this.updateRemoteBookmark(local);
      showNotification(i18nGet('SYNC_TO_REMOTE_SUCCESS'));
    }
  }

  async performPushWithMerge(local, diffResult, resolutionMap) {
    const localBar = await this.getBookmarkBar(local);
    const remote = await this.getRemoteBookmark();
    const remoteBar = await this.getBookmarkBar(remote);

    const merged = mergeBookmarks(diffBookmarks(localBar.children, remoteBar.children), resolutionMap);

    const mergedBookmark = {
      bookmarks: [
        {
          children: [
            {
              children: merged
            }
          ]
        }
      ]
    };

    await this.updateRemoteBookmark(mergedBookmark);
    showNotification(i18nGet('SYNC_TO_REMOTE_SUCCESS'));
  }

  async pull() {
    await this.syncFromRemote();
  }

  async push() {
    await this.syncToRemote();
  }

  async clearLocal() {
    const confirm = window.confirm(i18nGet('clear_local_confirm'));
    if (!confirm) return;
    
    const local = await this.getLocalBookmark();
    if (!this.isBookmarkAvailable(local)) {
      showNotification('本地书签为空');
      return;
    }
    
    const localBookmark = local.bookmarks[0].children[0];
    await this.clearBookmarks(localBookmark);
    showNotification(i18nGet('clear_success'));
  }
}

export const bookmarkManager = new BookmarkManager();