/** Shared React Query keys; keep list and detail keys in one place. */
export const queryKeys = {
  repositories: ['repositories'] as const,
  repository: (repositoryId: string, viewSyncId = '') => ['repository', repositoryId, viewSyncId] as const,
  activeUserJobs: ['active-jobs', 'user'] as const,
  activeAdminJobs: ['active-jobs', 'admin'] as const,
  userSession: ['user', 'session'] as const,
}
