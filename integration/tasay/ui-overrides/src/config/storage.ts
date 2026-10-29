// Keep previous story saves intact; the restored script starts in its own namespace.
export const STORAGE_KEYS = {
  session: "ta-say:original-story:session",
  persisted: "ta-say:original-story:persisted",
  latestShareCard: "ta-say:original-story:latest-share-card",
} as const;

export const STORAGE_VERSION = 2;
