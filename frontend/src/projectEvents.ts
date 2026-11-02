export const PROJECTS_CHANGED = 'jit:projects-changed'
export function projectsChanged() { window.dispatchEvent(new Event(PROJECTS_CHANGED)) }

export const PR_BATCH_CHANGED = 'jit:pr-batch-changed'
export function prBatchChanged() { window.dispatchEvent(new Event(PR_BATCH_CHANGED)) }
