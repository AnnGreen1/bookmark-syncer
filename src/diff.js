const browser = chrome;

let localBookmarks = [];
let remoteBookmarks = [];
let stagedItems = new Map();
let conflictItems = [];
let syncDirection = 'view';

const STATUS = {
  REMOTE_ONLY: 'remote_only',
  LOCAL_ONLY: 'local_only',
  MODIFIED: 'modified',
  CONFLICT: 'conflict',
  UNCHANGED: 'unchanged'
};

async function init() {
  const urlParams = new URLSearchParams(window.location.search);
  syncDirection = urlParams.get('direction') || 'view';
  
  try {
    await loadBookmarks();
    await loadRemoteBookmarks();
    await renderDiff();
    setupEventListeners();
  } catch (e) {
    console.error('Init failed:', e);
    alert('初始化失败: ' + e.message);
  }
}

async function loadBookmarks() {
  return new Promise((resolve) => {
    browser.bookmarks.getTree((tree) => {
      try {
        if (tree && tree[0] && tree[0].children) {
          let bookmarkBar = tree[0].children.find(c => c.id === '1');
          if (!bookmarkBar) {
            bookmarkBar = tree[0].children.find(c => c.title === '书签栏');
          }
          if (!bookmarkBar && tree[0].children.length > 0) {
            bookmarkBar = tree[0].children[0];
          }
          
          if (bookmarkBar && bookmarkBar.children) {
            localBookmarks = flattenBookmarks(bookmarkBar.children);
          }
        }
      } catch (e) {
        console.error('loadBookmarks failed:', e);
      }
      resolve();
    });
  });
}

async function loadRemoteBookmarks() {
  try {
    const opts = await browser.storage.sync.get(['options']);
    const options = typeof opts.options === 'string' ? JSON.parse(opts.options) : opts.options;
    const store = options?.store || 'github';
    const accessToken = options?.access_token || '';
    
    const baseUrl = store === 'github' ? 'https://api.github.com' : 'https://gitee.com/api/v5';
    const authHeader = store === 'github' ? `token ${accessToken}` : `Bearer ${accessToken}`;
    
    const response = await fetch(`${baseUrl}/gists`, {
      headers: {
        'Authorization': authHeader,
        'Accept': store === 'github' ? 'application/vnd.github.v3+json' : 'application/json'
      }
    });
    
    if (!response.ok) {
      remoteBookmarks = [];
      return;
    }
    
    const gists = await response.json();
    const bookmarkGist = gists.find(g => g.files && g.files['bookmark']);
    
    if (!bookmarkGist) {
      remoteBookmarks = [];
      return;
    }
    
    const gistResponse = await fetch(`${baseUrl}/gists/${bookmarkGist.id}`, {
      headers: {
        'Authorization': authHeader,
        'Accept': store === 'github' ? 'application/vnd.github.v3+json' : 'application/json'
      }
    });
    const gistData = await gistResponse.json();
    
    if (gistData.files && gistData.files['bookmark']) {
      const fileContent = gistData.files['bookmark'].content;
      const content = store === 'gitee' ? decodeURIComponent(fileContent) : fileContent;
      
      try {
        const parsed = JSON.parse(content);
        if (parsed.bookmarks && parsed.bookmarks[0] && parsed.bookmarks[0].children) {
          const bookmarkBar = parsed.bookmarks[0].children.find(c => c.title === '书签栏' || !c.url);
          if (bookmarkBar && bookmarkBar.children) {
            remoteBookmarks = flattenBookmarks(bookmarkBar.children);
          }
        }
      } catch (e) {
        console.error('Failed to parse remote bookmarks:', e);
        remoteBookmarks = [];
      }
    }
  } catch (e) {
    console.warn('Failed to load remote bookmarks:', e);
    remoteBookmarks = [];
  }
}

function flattenBookmarks(nodes, parentKey = '', depth = 0) {
  const result = [];
  nodes.forEach(node => {
    const key = node.url ? `url:${node.url}` : `folder:${node.title || node.id || Math.random().toString(36)}`;
    const fullKey = parentKey ? `${parentKey}/${key}` : key;
    
    result.push({
      ...node,
      _fullKey: fullKey,
      _depth: depth
    });
    
    if (node.children && node.children.length) {
      result.push(...flattenBookmarks(node.children, fullKey, depth + 1));
    }
  });
  return result;
}

function computeStatus(local, remote) {
  const localMap = new Map(local.map(b => [b._fullKey, b]));
  const remoteMap = new Map(remote.map(b => [b._fullKey, b]));
  
  const result = [];
  
  const allKeys = new Set([...localMap.keys(), ...remoteMap.keys()]);
  
  conflictItems = [];
  
  allKeys.forEach(key => {
    const local = localMap.get(key);
    const remote = remoteMap.get(key);
    
    let status = STATUS.UNCHANGED;
    let localItem = local;
    let remoteItem = remote;
    
    if (!local) {
      status = STATUS.REMOTE_ONLY;
    } else if (!remote) {
      status = STATUS.LOCAL_ONLY;
    } else {
      const isSameUrl = local.url === remote.url;
      const isSameTitle = local.title === remote.title;
      
      if (!isSameUrl || !isSameTitle) {
        status = STATUS.CONFLICT;
        conflictItems.push({ key, local, remote });
      }
    }
    
    result.push({
      key,
      status,
      local: localItem,
      remote: remoteItem
    });
  });
  
  return result;
}

async function renderDiff() {
  const diffResult = computeStatus(localBookmarks, remoteBookmarks);
  
  const localMap = new Map(localBookmarks.map(b => [b._fullKey, b]));
  const remoteMap = new Map(remoteBookmarks.map(b => [b._fullKey, b]));
  
  let addedCount = 0;
  let deletedCount = 0;
  
  diffResult.forEach(item => {
    if (item.status === STATUS.LOCAL_ONLY) {
      addedCount++;
    } else if (item.status === STATUS.REMOTE_ONLY) {
      deletedCount++;
    }
  });
  
  document.getElementById('statAdded').textContent = addedCount;
  document.getElementById('statDeleted').textContent = deletedCount;
  
  renderLocalPanel(diffResult);
  renderRemotePanel(diffResult);
  updateStagePanel();
  updateCommitButton();
}

function renderLocalPanel(diffResult) {
  const localList = document.getElementById('localFiles');
  localList.innerHTML = '';
  
  const localItems = diffResult.filter(item => item.local || item.status === STATUS.REMOTE_ONLY);
  
  localItems.forEach(item => {
    const li = document.createElement('li');
    li.className = 'file-item';
    li.dataset.key = item.key;
    
    const statusEl = document.createElement('div');
    statusEl.className = `file-status ${item.status}`;
    
    const sourceItem = item.local || item.remote;
    const icon = sourceItem?.url ? '🔗' : '📁';
    const iconEl = document.createElement('span');
    iconEl.className = 'file-icon';
    iconEl.textContent = icon;
    
    const nameEl = document.createElement('span');
    nameEl.className = 'file-name';
    nameEl.textContent = sourceItem?.title || '(无标题)';
    
    const pathEl = document.createElement('span');
    pathEl.className = 'file-path';
    if (sourceItem?.url) {
      pathEl.textContent = sourceItem.url;
    } else {
      pathEl.textContent = '(文件夹)';
    }
    
    const actions = document.createElement('div');
    actions.className = 'file-actions';
    
    const stageBtn = document.createElement('button');
    stageBtn.className = `stage-btn${stagedItems.has(item.key) ? ' staged' : ''}`;
    stageBtn.textContent = stagedItems.has(item.key) ? '取消' : '暂存';
    stageBtn.addEventListener('click', () => toggleStage(item.key, item));
    
    if (item.status === STATUS.CONFLICT) {
      const resolveBtn = document.createElement('button');
      resolveBtn.className = 'stage-btn';
      resolveBtn.textContent = '解决';
      resolveBtn.addEventListener('click', () => showConflictModal(item));
      actions.appendChild(resolveBtn);
    }
    
    actions.appendChild(stageBtn);
    
    li.appendChild(statusEl);
    li.appendChild(iconEl);
    li.appendChild(nameEl);
    li.appendChild(pathEl);
    li.appendChild(actions);
    
    if (!item.local) {
      li.style.opacity = '0.7';
      li.style.borderLeft = '3px dashed #22863a';
    }
    
    localList.appendChild(li);
  });
  
  if (localItems.length === 0) {
    const emptyMsg = document.createElement('li');
    emptyMsg.className = 'file-item';
    emptyMsg.textContent = '暂无书签';
    emptyMsg.style.color = '#999';
    emptyMsg.style.textAlign = 'center';
    localList.appendChild(emptyMsg);
  }
}

function renderRemotePanel(diffResult) {
  const remoteList = document.getElementById('remoteFiles');
  remoteList.innerHTML = '';
  
  const remoteItems = diffResult.filter(item => item.remote || item.status === STATUS.LOCAL_ONLY);
  
  remoteItems.forEach(item => {
    const li = document.createElement('li');
    li.className = 'file-item';
    li.dataset.key = item.key;
    
    const statusEl = document.createElement('div');
    statusEl.className = `file-status ${item.status}`;
    
    const sourceItem = item.remote || item.local;
    const icon = sourceItem?.url ? '🔗' : '📁';
    const iconEl = document.createElement('span');
    iconEl.className = 'file-icon';
    iconEl.textContent = icon;
    
    const nameEl = document.createElement('span');
    nameEl.className = 'file-name';
    nameEl.textContent = sourceItem?.title || '(无标题)';
    
    const pathEl = document.createElement('span');
    pathEl.className = 'file-path';
    if (sourceItem?.url) {
      pathEl.textContent = sourceItem.url;
    } else {
      pathEl.textContent = '(文件夹)';
    }
    
    const actions = document.createElement('div');
    actions.className = 'file-actions';
    
    const stageBtn = document.createElement('button');
    stageBtn.className = `stage-btn${stagedItems.has(item.key) ? ' staged' : ''}`;
    stageBtn.textContent = stagedItems.has(item.key) ? '取消' : '暂存';
    stageBtn.addEventListener('click', () => toggleStage(item.key, item));
    
    if (item.status === STATUS.CONFLICT) {
      const resolveBtn = document.createElement('button');
      resolveBtn.className = 'stage-btn';
      resolveBtn.textContent = '解决';
      resolveBtn.addEventListener('click', () => showConflictModal(item));
      actions.appendChild(resolveBtn);
    }
    
    actions.appendChild(stageBtn);
    
    li.appendChild(statusEl);
    li.appendChild(iconEl);
    li.appendChild(nameEl);
    li.appendChild(pathEl);
    li.appendChild(actions);
    
    if (!item.remote) {
      li.style.opacity = '0.7';
      li.style.borderLeft = '3px dashed #cb2431';
    }
    
    remoteList.appendChild(li);
  });
  
  if (remoteItems.length === 0) {
    const emptyMsg = document.createElement('li');
    emptyMsg.className = 'file-item';
    emptyMsg.textContent = '暂无书签';
    emptyMsg.style.color = '#999';
    emptyMsg.style.textAlign = 'center';
    remoteList.appendChild(emptyMsg);
  }
}

function toggleStage(key, item) {
  if (stagedItems.has(key)) {
    stagedItems.delete(key);
  } else {
    stagedItems.set(key, item);
  }
  
  updateStagePanel();
  updateCommitButton();
  
  const buttons = document.querySelectorAll(`[data-key="${key}"] .stage-btn`);
  buttons.forEach(btn => {
    btn.classList.toggle('staged');
    btn.textContent = stagedItems.has(key) ? '取消' : '暂存';
  });
}

function updateStagePanel() {
  const stageList = document.getElementById('stageList');
  stageList.innerHTML = '';
  
  const stagedCount = document.getElementById('stagedCount');
  stagedCount.textContent = stagedItems.size;
  
  stagedItems.forEach((item, key) => {
    const li = document.createElement('li');
    li.className = 'stage-item';
    
    const statusEl = document.createElement('div');
    statusEl.className = `file-status ${item.status}`;
    
    const icon = item.local?.url ? '🔗' : item.remote?.url ? '🔗' : '📁';
    const iconEl = document.createElement('span');
    iconEl.textContent = icon;
    
    const nameEl = document.createElement('span');
    nameEl.className = 'file-name';
    nameEl.textContent = item.local?.title || item.remote?.title || '(无标题)';
    
    li.appendChild(statusEl);
    li.appendChild(iconEl);
    li.appendChild(nameEl);
    
    stageList.appendChild(li);
  });
}

function updateCommitButton() {
  const btnCommit = document.getElementById('btnCommit');
  const btnCommitFinal = document.getElementById('btnCommitFinal');
  const hasConflicts = conflictItems.length > 0;
  const hasStaged = stagedItems.size > 0;
  
  btnCommit.disabled = hasConflicts || !hasStaged;
  btnCommitFinal.disabled = hasConflicts || !hasStaged;
}

function showConflictModal(item) {
  const modal = document.getElementById('conflictModal');
  const conflictView = document.getElementById('conflictView');
  
  conflictView.innerHTML = `
    <div class="conflict-side local">
      <div class="conflict-title">🔴 本地版本</div>
      <div class="conflict-item">
        <div class="title">${item.local?.title || '(无标题)'}</div>
        ${item.local?.url ? `<div class="url">${item.local.url}</div>` : ''}
      </div>
    </div>
    <div class="conflict-side remote">
      <div class="conflict-title">🟢 远程版本</div>
      <div class="conflict-item">
        <div class="title">${item.remote?.title || '(无标题)'}</div>
        ${item.remote?.url ? `<div class="url">${item.remote.url}</div>` : ''}
      </div>
    </div>
  `;
  
  modal.classList.add('show');
  
  const keepLocal = document.getElementById('btnKeepLocal');
  const keepRemote = document.getElementById('btnKeepRemote');
  const modalClose = document.getElementById('modalClose');
  
  const handleKeepLocal = () => {
    stagedItems.set(item.key, { ...item, resolved: 'local' });
    const index = conflictItems.findIndex(c => c.key === item.key);
    if (index > -1) conflictItems.splice(index, 1);
    closeModal();
  };
  
  const handleKeepRemote = () => {
    stagedItems.set(item.key, { ...item, resolved: 'remote' });
    const index = conflictItems.findIndex(c => c.key === item.key);
    if (index > -1) conflictItems.splice(index, 1);
    closeModal();
  };
  
  const closeModal = () => {
    modal.classList.remove('show');
    keepLocal.removeEventListener('click', handleKeepLocal);
    keepRemote.removeEventListener('click', handleKeepRemote);
    modalClose.removeEventListener('click', closeModal);
    updateStagePanel();
    updateCommitButton();
    renderDiff();
  };
  
  keepLocal.addEventListener('click', handleKeepLocal);
  keepRemote.addEventListener('click', handleKeepRemote);
  modalClose.addEventListener('click', closeModal);
}

function setupEventListeners() {
  document.getElementById('btnCancel').addEventListener('click', () => {
    browser.tabs.getCurrent((tab) => browser.tabs.remove(tab.id));
  });
  
  document.getElementById('btnStageAll').addEventListener('click', () => {
    const diffResult = computeStatus(localBookmarks, remoteBookmarks);
    diffResult.forEach(item => {
      if (item.status !== STATUS.UNCHANGED && !stagedItems.has(item.key)) {
        stagedItems.set(item.key, item);
      }
    });
    updateStagePanel();
    updateCommitButton();
    renderDiff();
  });
  
  document.getElementById('btnUnstageAll').addEventListener('click', () => {
    stagedItems.clear();
    updateStagePanel();
    updateCommitButton();
    renderDiff();
  });
  
  document.getElementById('btnCommit').addEventListener('click', commitAndPush);
  document.getElementById('btnCommitFinal').addEventListener('click', commitAndPush);
}

async function commitAndPush() {
  if (stagedItems.size === 0) {
    alert('没有需要提交的变更');
    return;
  }
  
  try {
    const mergedItems = [];
    
    stagedItems.forEach((item) => {
      let selectedItem = null;
      
      if (item.status === STATUS.REMOTE_ONLY) {
        selectedItem = item.remote;
      } else if (item.status === STATUS.LOCAL_ONLY) {
        selectedItem = item.local;
      } else if (item.status === STATUS.CONFLICT) {
        selectedItem = item.resolved === 'local' ? item.local : item.remote;
      } else {
        selectedItem = item.local || item.remote;
      }
      
      if (selectedItem) {
        mergedItems.push({ ...selectedItem });
      }
    });
    
    const nested = rebuildTree(mergedItems);
    
    const opts = await browser.storage.sync.get(['options']);
    const options = typeof opts.options === 'string' ? JSON.parse(opts.options) : opts.options;
    const store = options?.store || 'github';
    const accessToken = options?.access_token || '';
    
    const baseUrl = store === 'github' ? 'https://api.github.com' : 'https://gitee.com/api/v5';
    const authHeader = store === 'github' ? `token ${accessToken}` : `Bearer ${accessToken}`;
    
    const content = JSON.stringify({
      bookmarks: [{
        children: [{
          title: '书签栏',
          children: nested
        }]
      }]
    }, null, 2);
    
    const encodedContent = store === 'gitee' ? encodeURIComponent(content) : content;
    
    const bookmarkGist = await getOrCreateBookmarkGist(baseUrl, authHeader, store, encodedContent);
    
    if (bookmarkGist) {
      await updateBookmarkGist(baseUrl, authHeader, store, bookmarkGist.id, encodedContent);
      alert('提交成功！');
      browser.tabs.getCurrent((tab) => browser.tabs.remove(tab.id));
    }
  } catch (e) {
    console.error('Commit failed:', e);
    alert('提交失败: ' + e.message);
  }
}

async function getOrCreateBookmarkGist(baseUrl, authHeader, store, content) {
  try {
    const response = await fetch(`${baseUrl}/gists`, {
      headers: {
        'Authorization': authHeader,
        'Accept': store === 'github' ? 'application/vnd.github.v3+json' : 'application/json'
      }
    });
    
    if (!response.ok) {
      console.warn('Failed to fetch gists, will create new');
      return await createBookmarkGist(baseUrl, authHeader, store, content);
    }
    
    const gists = await response.json();
    const bookmarkGist = gists.find(g => g.files && g.files['bookmark']);
    
    if (!bookmarkGist) {
      console.log('Bookmark gist not found, creating new');
      return await createBookmarkGist(baseUrl, authHeader, store, content);
    }
    
    return bookmarkGist;
  } catch (e) {
    console.warn('Error checking gist existence, creating new:', e);
    return await createBookmarkGist(baseUrl, authHeader, store, content);
  }
}

async function createBookmarkGist(baseUrl, authHeader, store, content) {
  const response = await fetch(`${baseUrl}/gists`, {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
      'Accept': store === 'github' ? 'application/vnd.github.v3+json' : 'application/json'
    },
    body: JSON.stringify({
      description: 'my gist for bookmark sync',
      files: {
        'bookmark': { content: content }
      },
      public: false
    })
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to create gist: ${error.message || response.statusText}`);
  }
  
  return await response.json();
}

async function updateBookmarkGist(baseUrl, authHeader, store, gistId, content) {
  const response = await fetch(`${baseUrl}/gists/${gistId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
      'Accept': store === 'github' ? 'application/vnd.github.v3+json' : 'application/json'
    },
    body: JSON.stringify({
      files: {
        'bookmark': { content: content }
      }
    })
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to update gist: ${error.message || response.statusText}`);
  }
}

function rebuildTree(items) {
  const keyMap = {};
  const result = [];
  
  items.forEach(item => {
    const node = {
      title: item.title,
      url: item.url,
      children: []
    };
    keyMap[item._fullKey] = node;
    
    const parts = item._fullKey.split('/');
    parts.pop();
    const parentKey = parts.join('/');
    
    if (!parentKey) {
      result.push(node);
    } else if (keyMap[parentKey]) {
      keyMap[parentKey].children.push(node);
    }
  });
  
  return result;
}

document.addEventListener('DOMContentLoaded', init);