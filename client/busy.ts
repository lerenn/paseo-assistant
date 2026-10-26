/** Agent statuses in which the Assistant is working and its sidebar row shows the busy indicator. */
export const isBusyStatus = (status: string | null | undefined): boolean => status === "running" || status === "initializing";
