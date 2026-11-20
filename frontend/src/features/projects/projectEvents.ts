export const PROJECTS_CHANGED = 'jit:projects-changed'
export function projectsChanged() { window.dispatchEvent(new Event(PROJECTS_CHANGED)) }
