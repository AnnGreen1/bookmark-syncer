export const DIFF_TYPES = {
  ADDED: 'added',
  DELETED: 'deleted',
  MODIFIED: 'modified',
  CONFLICT: 'conflict',
  UNCHANGED: 'unchanged'
};

function generateNodeKey(node) {
  if (node.url) {
    return `url:${node.url}`;
  }
  return `folder:${node.title || node.id || Math.random().toString(36)}`;
}

function flattenBookmarks(bookmarks, parentKey = '') {
  const result = {};
  function traverse(nodes, prefix) {
    nodes.forEach(node => {
      const key = generateNodeKey(node);
      const fullKey = prefix ? `${prefix}/${key}` : key;
      result[fullKey] = { ...node, _fullKey: fullKey };
      if (node.children && node.children.length > 0) {
        traverse(node.children, fullKey);
      }
    });
  }
  traverse(bookmarks, parentKey);
  return result;
}

function compareNodes(local, remote) {
  if (!local) return { type: DIFF_TYPES.ADDED, remote };
  if (!remote) return { type: DIFF_TYPES.DELETED, local };
  
  const isFolder = !local.url && !remote.url;
  const isSameUrl = local.url === remote.url;
  const isSameTitle = local.title === remote.title;
  
  if (isSameUrl && isSameTitle) {
    return { type: DIFF_TYPES.UNCHANGED, local, remote };
  }
  
  if (isFolder) {
    if (local.title !== remote.title) {
      return { type: DIFF_TYPES.MODIFIED, local, remote, reason: 'title' };
    }
    return { type: DIFF_TYPES.UNCHANGED, local, remote };
  }
  
  if (!isSameUrl) {
    return { type: DIFF_TYPES.CONFLICT, local, remote, reason: 'url' };
  }
  
  if (!isSameTitle) {
    return { type: DIFF_TYPES.CONFLICT, local, remote, reason: 'title' };
  }
  
  return { type: DIFF_TYPES.UNCHANGED, local, remote };
}

export function diffBookmarks(localBookmarks, remoteBookmarks) {
  const localFlatten = flattenBookmarks(localBookmarks);
  const remoteFlatten = flattenBookmarks(remoteBookmarks);
  
  const allKeys = new Set([...Object.keys(localFlatten), ...Object.keys(remoteFlatten)]);
  const diffResult = {
    added: [],
    deleted: [],
    modified: [],
    conflict: [],
    unchanged: [],
    hasChanges: false,
    hasConflicts: false
  };
  
  allKeys.forEach(key => {
    const local = localFlatten[key];
    const remote = remoteFlatten[key];
    const comparison = compareNodes(local, remote);
    
    diffResult[comparison.type + 's'].push(comparison);
    
    if (comparison.type !== DIFF_TYPES.UNCHANGED) {
      diffResult.hasChanges = true;
    }
    if (comparison.type === DIFF_TYPES.CONFLICT) {
      diffResult.hasConflicts = true;
    }
  });
  
  return diffResult;
}

export function buildTreeFromDiff(diffResult, resolutionMap = {}) {
  const result = [];
  const keyMap = {};
  
  function addToParent(node, fullKey) {
    const parts = fullKey.split('/');
    parts.pop();
    const parentKey = parts.join('/');
    
    if (!parentKey) {
      result.push(node);
    } else if (keyMap[parentKey]) {
      if (!keyMap[parentKey].children) {
        keyMap[parentKey].children = [];
      }
      keyMap[parentKey].children.push(node);
    }
  }
  
  diffResult.added.forEach(item => {
    const node = { ...item.remote, _diffType: DIFF_TYPES.ADDED };
    keyMap[item.remote._fullKey] = node;
    addToParent(node, item.remote._fullKey);
  });
  
  diffResult.deleted.forEach(item => {
    const resolution = resolutionMap[item.local._fullKey];
    if (resolution === 'keep') {
      const node = { ...item.local, _diffType: DIFF_TYPES.DELETED };
      keyMap[item.local._fullKey] = node;
      addToParent(node, item.local._fullKey);
    }
  });
  
  diffResult.modified.forEach(item => {
    const node = { ...item.remote, _diffType: DIFF_TYPES.MODIFIED };
    keyMap[item.remote._fullKey] = node;
    addToParent(node, item.remote._fullKey);
  });
  
  diffResult.conflict.forEach(item => {
    const resolution = resolutionMap[item.local._fullKey] || 'remote';
    const source = resolution === 'local' ? item.local : item.remote;
    const node = { ...source, _diffType: DIFF_TYPES.CONFLICT, _resolution: resolution };
    keyMap[source._fullKey] = node;
    addToParent(node, source._fullKey);
  });
  
  diffResult.unchanged.forEach(item => {
    const node = { ...item.local, _diffType: DIFF_TYPES.UNCHANGED };
    keyMap[item.local._fullKey] = node;
    addToParent(node, item.local._fullKey);
  });
  
  return result;
}

export function hasConflicts(diffResult) {
  return diffResult.hasConflicts;
}

export function hasChanges(diffResult) {
  return diffResult.hasChanges;
}