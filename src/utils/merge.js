import { DIFF_TYPES, buildTreeFromDiff } from './diff.js';

export const MERGE_STRATEGIES = {
  LOCAL: 'local',
  REMOTE: 'remote',
  MERGE: 'merge'
};

export function mergeBookmarks(diffResult, resolutionMap = {}) {
  const merged = buildTreeFromDiff(diffResult, resolutionMap);
  return cleanDiffMetadata(merged);
}

function cleanDiffMetadata(nodes) {
  return nodes.map(node => {
    const cleaned = { ...node };
    delete cleaned._diffType;
    delete cleaned._fullKey;
    delete cleaned._resolution;
    if (cleaned.children && cleaned.children.length > 0) {
      cleaned.children = cleanDiffMetadata(cleaned.children);
    }
    return cleaned;
  });
}

export function autoMerge(diffResult) {
  const resolutionMap = {};
  
  diffResult.conflict.forEach(conflict => {
    const localKey = conflict.local._fullKey;
    const localModified = new Date(conflict.local.dateAdded || 0);
    const remoteModified = new Date(conflict.remote.dateAdded || 0);
    
    if (localModified > remoteModified) {
      resolutionMap[localKey] = MERGE_STRATEGIES.LOCAL;
    } else {
      resolutionMap[localKey] = MERGE_STRATEGIES.REMOTE;
    }
  });
  
  diffResult.deleted.forEach(deletion => {
    resolutionMap[deletion.local._fullKey] = 'discard';
  });
  
  return resolutionMap;
}

export function applyResolution(diffResult, fullKey, resolution) {
  const resolutionMap = {};
  resolutionMap[fullKey] = resolution;
  return resolutionMap;
}

export function createMergeResult(diffResult, resolutionMap) {
  return {
    merged: mergeBookmarks(diffResult, resolutionMap),
    diffResult,
    resolutionMap,
    summary: generateMergeSummary(diffResult, resolutionMap)
  };
}

function generateMergeSummary(diffResult, resolutionMap) {
  const summary = {
    added: diffResult.added.length,
    deleted: diffResult.deleted.length,
    modified: diffResult.modified.length,
    conflicts: diffResult.conflict.length,
    unchanged: diffResult.unchanged.length,
    resolvedConflicts: 0,
    keptLocal: 0,
    keptRemote: 0
  };
  
  diffResult.conflict.forEach(conflict => {
    const resolution = resolutionMap[conflict.local._fullKey];
    if (resolution) {
      summary.resolvedConflicts++;
      if (resolution === MERGE_STRATEGIES.LOCAL) {
        summary.keptLocal++;
      } else if (resolution === MERGE_STRATEGIES.REMOTE) {
        summary.keptRemote++;
      }
    }
  });
  
  return summary;
}

export function resolveAllConflicts(diffResult, strategy) {
  const resolutionMap = {};
  
  diffResult.conflict.forEach(conflict => {
    resolutionMap[conflict.local._fullKey] = strategy;
  });
  
  return resolutionMap;
}