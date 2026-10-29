const completionKey = "ta-say:she-love-me:completed";
const legacyPersistedKey = "ta-say:persisted";
const currentPersistedKey = "ta-say:original-story:persisted";
type CompletionStorage = Pick<Storage, "getItem" | "setItem">;
// A replay may rebuild the store without persistence. Keep the completion for
// this page's lifetime, including ChatPage remounts, when storage is blocked.
let completedInThisPage = false;

function browserStorage(): CompletionStorage | null {
  try { return window.localStorage; } catch { return null; }
}

function readJson(storage: CompletionStorage | null, key: string): unknown {
  try { return JSON.parse(storage?.getItem(key) ?? "null"); } catch { return null; }
}

// Carry over only the completed flag, never the previous version's story session.
export function readStoredStoryCompletion(storage: CompletionStorage | null = browserStorage()): boolean {
  if (completedInThisPage) return true;
  if (readJson(storage, completionKey) === true) return true;
  return [currentPersistedKey, legacyPersistedKey].some((key) => {
    const saved = readJson(storage, key);
    return typeof saved === "object" && saved !== null &&
      "version" in saved && saved.version === 2 &&
      "hasFinishedGame" in saved && saved.hasFinishedGame === true;
  });
}

export function rememberStoryCompletion(hasFinishedGame: boolean, storage: CompletionStorage | null = browserStorage()): void {
  if (hasFinishedGame !== true) return;
  completedInThisPage = true;
  try { storage?.setItem(completionKey, "true"); } catch { /* Keep the current session usable without storage. */ }
}
