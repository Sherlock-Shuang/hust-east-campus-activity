import { useEffect, useLayoutEffect, useMemo, useRef, useState, Fragment, type KeyboardEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAppStore } from "../../app/store/useAppStore";
import { exitCopy, mockChatCopy, rollbackCopy, storyCopy } from "../../config/hardcodedCopy";
import { getStageStatus } from "../../features/story/stageConfig";
import { countNarrativeConversationMessages, type ChatMessage } from "../../types/session";
import { useChatViewport } from "../../hooks/useChatViewport";

import { MobileIcon, MobileTabBar, mobileTabs, usePhoneLayout, type MobileTab } from "../../components/MobileMessenger";

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function createMockTimestamp(hour: number, minute: number) {
  const now = new Date();
  now.setHours(hour, minute, 0, 0);
  return now.getTime();
}

function createMockMessage(
  id: string,
  role: ChatMessage["role"],
  displayedText: string,
  hour: number,
  minute: number,
): ChatMessage {
  return {
    id,
    role,
    displayedText,
    kind: "normal",
    timestamp: createMockTimestamp(hour, minute)
  };
}

type MockConversationId = "assistant" | "favorite" | "group";
type ConversationId = "z" | MockConversationId;

type MockConversation = {
  id: MockConversationId;
  name: string;
  subtitle: string;
  avatarLabel: string;
  messages: ChatMessage[];
  replyPool: string[];
  view?: "chat" | "articles";
  articles?: Array<{
    id: string;
    source: string;
    title: string;
    meta: string;
    summary: string;
    tag?: string;
  }>;
};

type ConversationListItem = {
  id: ConversationId;
  name: string;
  subtitle: string;
  avatarLabel: string;
  preview: string;
  time: string;
  hasUnread: boolean;
};

type StoryConversation = {
  id: "z";
  name: string;
  subtitle: string;
  avatarLabel: string;
  isStory: true;
  view: "chat";
  articles: [];
  messages: ChatMessage[];
};

type ActiveConversation = StoryConversation | (MockConversation & { isStory: false });

function createInitialMockConversations(): Record<MockConversationId, MockConversation> {
  return {
    assistant: {
      ...mockChatCopy.assistant,
      messages: mockChatCopy.assistant.messages.map((message) =>
        createMockMessage(message.id, message.role, message.displayedText, message.hour, message.minute)
      ),
      replyPool: [...mockChatCopy.assistant.replyPool]
    },
    favorite: {
      ...mockChatCopy.favorite,
      articles: [...mockChatCopy.favorite.articles],
      messages: mockChatCopy.favorite.messages.map((message) =>
        createMockMessage(message.id, message.role, message.displayedText, message.hour, message.minute)
      ),
      replyPool: [...mockChatCopy.favorite.replyPool]
    },
    group: {
      ...mockChatCopy.group,
      messages: mockChatCopy.group.messages.map((message) =>
        createMockMessage(message.id, message.role, message.displayedText, message.hour, message.minute)
      ),
      replyPool: [...mockChatCopy.group.replyPool]
    }
  };
}

const scriptedGroupIds = new Set<string>(Object.values(mockChatCopy.group.variants).flatMap((variant) => variant.messages.map((message) => message.id)));
type ChatUiState = {
  runKey: string;
  drafts: Record<ConversationId, string>;
  selectedConversationId: ConversationId;
  viewed: Record<MockConversationId, string>;
  conversations: Record<MockConversationId, MockConversation>;
  expandedArticles: string[];
  readGroupMessageId?: string;
};
const chatUiKey = "ta-say:original-story:chat-ui:v1";
function readChatUi(runKey: string): ChatUiState | null {
  try {
    const value = JSON.parse(localStorage.getItem(chatUiKey) ?? "null") as ChatUiState | null;
    if (!value || value.runKey !== runKey || !["z", "assistant", "favorite", "group"].includes(value.selectedConversationId)) return null;
    if (!["z", "assistant", "favorite", "group"].every((id) => typeof value.drafts?.[id as ConversationId] === "string")) return null;
    if (!["assistant", "favorite", "group"].every((id) => Array.isArray(value.conversations?.[id as MockConversationId]?.messages) && typeof value.viewed?.[id as MockConversationId] === "string")) return null;
    if (!Array.isArray(value.expandedArticles)) return null;
    return value;
  } catch {return null;}
}
function writeChatUi(value: ChatUiState) {
  try {localStorage.setItem(chatUiKey, JSON.stringify(value));} catch { /* Keep playing if storage is unavailable. */ }
}

function ChatSidebarIcon() {
  return (
    <svg className="desktop-sidebar-svg chat" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4.5" y="5" width="15" height="13.5" rx="4.2" />
      <circle cx="12" cy="11.75" r="2.55" />
    </svg>
  );
}

function SpaceSidebarIcon() {
  return (
    <svg className="desktop-sidebar-svg space" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="7.2" />
      <path d="M12 4.8c1.8 1.8 2.8 4.3 2.8 7.2s-1 5.4-2.8 7.2c-1.8-1.8-2.8-4.3-2.8-7.2s1-5.4 2.8-7.2Z" />
      <path d="M4.8 12h14.4" />
      <path d="M7.2 7.2c1.5 1 3.1 1.5 4.8 1.5s3.3-.5 4.8-1.5" />
      <path d="M7.2 16.8c1.5-1 3.1-1.5 4.8-1.5s3.3.5 4.8 1.5" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg className="desktop-search-svg" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="4.5" />
      <path d="M12 12l4 4" />
    </svg>
  );
}

function getChatDisturbanceLevel(stage: string) {
  switch (stage) {
    case "first_pollution":
    case "draft_exposed":
    case "time_pollution":
      return 1;
    case "save_loaded_once":
    case "save_loaded_twice":
    case "location_reveal":
      return 2;
    case "location_aftermath":
    case "meta_break":
    case "truth_reveal":
      return 3;
    default:
      return 0;
  }
}

function getFavoriteCollectionTone(stage: string, totalConversationCount: number) {
  if (totalConversationCount >= 15) {
    return "uncanny" as const;
  }

  switch (stage) {
    case "save_loaded_twice":
    case "location_reveal":
    case "location_aftermath":
    case "meta_break":
    case "truth_reveal":
    case "wake_up":
    case "translator_unlocked":
      return "uncanny" as const;
    case "first_pollution":
    case "draft_exposed":
    case "time_pollution":
    case "save_loaded_once":
      return "uneasy" as const;
    default:
      return "normal" as const;
  }
}

function getWorkGroupTone(stage: string, totalConversationCount: number) {
  if (totalConversationCount >= 15) {
    return "uncanny" as const;
  }

  switch (stage) {
    case "save_loaded_twice":
    case "location_reveal":
    case "location_aftermath":
    case "meta_break":
    case "truth_reveal":
    case "wake_up":
    case "translator_unlocked":
      return "uncanny" as const;
    case "first_pollution":
    case "draft_exposed":
    case "time_pollution":
    case "save_loaded_once":
      return "uneasy" as const;
    default:
      return totalConversationCount >= 9 ? ("uneasy" as const) : ("normal" as const);
  }
}

function normalizeHauntingText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function ChatPage() {
  useChatViewport();
  const navigate = useNavigate();
  const phone = usePhoneLayout();
  const [searchParams, setSearchParams] = useSearchParams();
  const chatOpen = searchParams.get("panel") !== "list";
  const conversationVisible = !phone || chatOpen;
  const [mobileTab, setMobileTab] = useState<MobileTab>("chats");
  const [menuOpen, setMenuOpen] = useState(false);
  const [composerPanel, setComposerPanel] = useState<"emoji" | "more" | "voice" | null>(null);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const composingRef = useRef(false);
  const touchStartRef = useRef<{x: number; y: number} | null>(null);
  useEffect(() => {
    const close = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { setMenuOpen(false); setComposerPanel(null); }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);
  const session = useAppStore((state) => state.session);
  const isReplying = useAppStore((state) => state.isReplying);
  const isTaTyping = useAppStore((state) => state.isTaTyping);
  const pendingUserMessages = useAppStore((state) => state.pendingUserMessages);
  const draftWhisper = useAppStore((state) => state.draftWhisper);
  const draftEditCount = useAppStore((state) => state.draftEditCount);
  const draftPauseLevel = useAppStore((state) => state.draftPauseLevel);
  const sendMessage = useAppStore((state) => state.sendMessage);
  const updateDraft = useAppStore((state) => state.updateDraft);
  const rollbackToMessage = useAppStore((state) => state.rollbackToMessage);
  const visitSpace = useAppStore((state) => state.visitSpace);
  const exitAttempt = useAppStore((state) => state.exitAttempt);
  const sendLocationTurnBack = useAppStore((state) => state.sendLocationTurnBack);
  const enterTruthReveal = useAppStore((state) => state.enterTruthReveal);
  const revealLocationLie = useAppStore((state) => state.revealLocationLie);
  const revealLocationOmnipresence = useAppStore((state) => state.revealLocationOmnipresence);
  const getSpaceLabel = useAppStore((state) => state.getSpaceLabel);
  const runKey = session.chatHistory[0]?.id ?? "new";
  const [savedUi] = useState(() => readChatUi(runKey));
  const [drafts, setDrafts] = useState<Record<ConversationId, string>>(() => savedUi?.drafts ?? { z: "", assistant: "", favorite: "", group: "" });
  const resetForReplay = useAppStore((state) => state.resetForReplay);
  const gameFinished = session.stage === "wake_up" && session.hasFinishedGame;
  const [expandedArticles, setExpandedArticles] = useState<string[]>(() => savedUi?.expandedArticles ?? []);
  const followScrollRef = useRef(true);
  const lastConversationRef = useRef<ConversationId>("z");
  const scrollPositionsRef = useRef<Partial<Record<ConversationId, {top: number; following: boolean}>>>({});
  const lastMessageIdsRef = useRef<Partial<Record<ConversationId, string>>>({});
  const [rollbackMode, setRollbackMode] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const rollbackDisabled = session.loadCount >= 3;
  const [searchKeyword, setSearchKeyword] = useState("");
  const [selectedConversationId, setSelectedConversationId] = useState<ConversationId>(savedUi?.selectedConversationId ?? "z");
  const [mockReplyingConversationId, setMockReplyingConversationId] = useState<string | null>(null);
  const [showExitDialog, setShowExitDialog] = useState(false);
  const [lastViewedConversationSignals, setLastViewedConversationSignals] = useState<Record<MockConversationId, string>>(savedUi?.viewed ?? { assistant: "", favorite: "", group: "" });
  const [mockConversations, setMockConversations] = useState<Record<MockConversationId, MockConversation>>(() =>
    savedUi?.conversations ?? createInitialMockConversations()
  );
  const latestGroupReplyId = useMemo(() => {
    const replies = mockConversations.group.messages.filter(message => message.role === "ta");
    return replies[replies.length - 1]?.id ?? "";
  }, [mockConversations.group.messages]);
  const [readGroupMessageId, setReadGroupMessageId] = useState(() => typeof savedUi?.readGroupMessageId === "string" ? savedUi.readGroupMessageId : latestGroupReplyId);
  useEffect(() => {
    if (conversationVisible && selectedConversationId === "group") setReadGroupMessageId(latestGroupReplyId);
  }, [conversationVisible, selectedConversationId, latestGroupReplyId]);
  const draft = drafts[selectedConversationId] ?? "";
  const setDraft = (value: string) => setDrafts((current) => ({ ...current, [selectedConversationId]: value }));
  useLayoutEffect(() => {
    const resize = () => {
      const input = inputRef.current;
      if (!input) return;
      input.style.height = "auto";
      input.style.height = `${Math.min(input.scrollHeight, 132)}px`;
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [draft, selectedConversationId]);
  const latestUiRef = useRef<ChatUiState | null>(null);
  latestUiRef.current = {runKey, drafts, selectedConversationId, viewed: lastViewedConversationSignals, conversations: mockConversations, expandedArticles, readGroupMessageId};
  useEffect(() => {
    const timer = window.setTimeout(() => { if (latestUiRef.current) writeChatUi(latestUiRef.current); }, 180);
    return () => window.clearTimeout(timer);
  }, [runKey, drafts, selectedConversationId, lastViewedConversationSignals, mockConversations, expandedArticles, readGroupMessageId]);
  useEffect(() => {
    const flush = () => { if (latestUiRef.current) writeChatUi(latestUiRef.current); };
    const onVisibility = () => { if (document.hidden) flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => { flush(); window.removeEventListener("pagehide", flush); document.removeEventListener("visibilitychange", onVisibility); };
  }, []);
  const streamRef = useRef<HTMLDivElement | null>(null);
  const pendingTimersRef = useRef<number[]>([]);
  const toastTimerRef = useRef<number | null>(null);
  const seenSystemNoticeIdsRef = useRef<Set<string>>(new Set());
  const hasInitializedSystemNoticeHistoryRef = useRef(false);
  const [systemToast, setSystemToast] = useState<ChatMessage | null>(null);
  const [rollbackFlashNonce, setRollbackFlashNonce] = useState(0);
  const [rollbackFlashVisible, setRollbackFlashVisible] = useState(false);
  const endingTransitionActive = session.stage === "location_aftermath";
  const totalConversationCount = countNarrativeConversationMessages(session.chatHistory);

  useEffect(() => {
    if (session.stage === "meta_break" || session.stage === "truth_reveal") {
      navigate("/truth", { replace: true });
    }
  }, [navigate, session.stage, session.taPronoun]);

  useEffect(() => {
    if (session.stage !== "location_aftermath") {
      return;
    }

    if (session.metaMemory.includes("定位结尾已进入真相页。")) {
      return;
    }

    let turnBackTimer: number | undefined;
    let lieTimer: number | undefined;
    let omnipresenceTimer: number | undefined;
    let truthTimer: number | undefined;

    const runSequence = () => {
      turnBackTimer = window.setTimeout(() => {
        sendLocationTurnBack();

        lieTimer = window.setTimeout(() => {
          revealLocationLie();

          omnipresenceTimer = window.setTimeout(() => {
            revealLocationOmnipresence();

            truthTimer = window.setTimeout(() => {
              useAppStore.getState().patchSession({
                metaMemory: [...useAppStore.getState().session.metaMemory, "定位结尾已进入真相页。"]
              });
              enterTruthReveal();
              navigate("/truth", { replace: true });
            }, 3000);
          }, 2000);
        }, 3000);
      }, 3000);
    };

    runSequence();

    return () => {
      if (turnBackTimer) {
        window.clearTimeout(turnBackTimer);
      }
      if (lieTimer) {
        window.clearTimeout(lieTimer);
      }
      if (omnipresenceTimer) {
        window.clearTimeout(omnipresenceTimer);
      }
      if (truthTimer) {
        window.clearTimeout(truthTimer);
      }
    };
  }, [
    enterTruthReveal,
    navigate,
    revealLocationLie,
    revealLocationOmnipresence,
    sendLocationTurnBack,
    session.stage
  ]);

  useEffect(() => {
    return () => {
      pendingTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const latestMessage = session.chatHistory[session.chatHistory.length - 1];
  const lastStorySeenRef = useRef<string | undefined>(selectedConversationId === "z" && conversationVisible ? latestMessage?.id : undefined);
  useEffect(() => {if (selectedConversationId === "z" && conversationVisible) lastStorySeenRef.current = latestMessage?.id;}, [selectedConversationId, latestMessage?.id, conversationVisible]);
  const exitDialogTitle =
    session.exitClickCount >= 2
      ? exitCopy.dialogTitles.locked
      : session.exitClickCount >= 1
        ? exitCopy.dialogTitles.warning
        : exitCopy.dialogTitles.default;
  const exitDialogBody =
    session.exitClickCount >= 2
      ? exitCopy.dialogBodies.locked
      : session.exitClickCount >= 1
        ? exitCopy.dialogBodies.warning
        : exitCopy.dialogBodies.default;
  const favoriteCollectionTone = getFavoriteCollectionTone(session.stage, totalConversationCount);
  const groupThreadTone = getWorkGroupTone(session.stage, totalConversationCount);
  const disturbanceLevel = getChatDisturbanceLevel(session.stage);
  const hauntingLines = [
    ...session.deletedDrafts.slice(-2).map(normalizeHauntingText),
    session.hardestSentence ? normalizeHauntingText(session.hardestSentence) : "",
  ].filter(Boolean);
  const primaryHauntingLine = hauntingLines[0] || "";
  const disturbanceCopy = draftWhisper || primaryHauntingLine;
  const composerWarning = draftWhisper || "";
  const favoriteVariant = mockChatCopy.favorite.variants[favoriteCollectionTone];
  const groupVariant = mockChatCopy.group.variants[groupThreadTone];
  const favoriteSignal = `${favoriteCollectionTone}:${favoriteVariant.articles.map((article) => article.id).join("|")}`;
  const groupSignal = `${groupThreadTone}:${groupVariant.messages.map((message) => message.id).join("|")}`;

  useEffect(() => {
    setMockConversations((current) => {
      const currentGroup = current.group;
      const currentSignal = [
        currentGroup.subtitle,
        currentGroup.avatarLabel,
        currentGroup.messages.map((message) => message.id).join("|"),
        currentGroup.replyPool.join("|")
      ].join("::");
      const nextSignal = [
        groupVariant.subtitle,
        groupVariant.avatarLabel,
        groupVariant.messages.map((message) => message.id).join("|"),
        groupVariant.replyPool.join("|")
      ].join("::");

      if (currentSignal === nextSignal) {
        return current;
      }

      return {
        ...current,
        group: {
          ...currentGroup,
          subtitle: groupVariant.subtitle,
          avatarLabel: groupVariant.avatarLabel,
          messages: [
            ...groupVariant.messages.map((message) => createMockMessage(message.id, message.role, message.displayedText, message.hour, message.minute)),
            ...currentGroup.messages.filter((message) => !scriptedGroupIds.has(message.id))
          ],
          replyPool: [...groupVariant.replyPool]
        }
      };
    });
  }, [groupVariant]);

  useEffect(() => {
    if (selectedConversationId === "favorite" && conversationVisible) {
      setLastViewedConversationSignals((current) =>
        current.favorite === favoriteSignal ? current : { ...current, favorite: favoriteSignal }
      );
    }

    if (selectedConversationId === "group" && conversationVisible) {
      setLastViewedConversationSignals((current) =>
        current.group === groupSignal ? current : { ...current, group: groupSignal }
      );
    }
  }, [favoriteSignal, groupSignal, selectedConversationId, conversationVisible]);

  const favoriteHasUnread =
    favoriteCollectionTone !== "normal" && lastViewedConversationSignals.favorite !== favoriteSignal;
  const groupHasUnread = (groupThreadTone !== "normal" && lastViewedConversationSignals.group !== groupSignal) || readGroupMessageId !== latestGroupReplyId;
  const displayConversations = useMemo<Record<MockConversationId, MockConversation>>(() => {
    return {
      ...mockConversations,
      favorite: {
        ...mockConversations.favorite,
        subtitle: favoriteVariant.subtitle,
        avatarLabel: favoriteVariant.avatarLabel,
        articles: favoriteVariant.articles.map((article) => ({ ...article }))
      }
    };
  }, [favoriteVariant, mockConversations]);

  const allConversationItems = useMemo<ConversationListItem[]>(() => {
    const storyPreviewText = latestMessage?.displayedText ?? "开始新的聊天";
    const storyPreviewTime = latestMessage ? formatTime(latestMessage.timestamp) : "刚刚";
    const allItems: ConversationListItem[] = [
      {
        id: "z",
        name: "宝宝",
        subtitle: getStageStatus(session.stage),
        avatarLabel: "宝",
        preview: storyPreviewText,
        time: storyPreviewTime,
        hasUnread: (!conversationVisible || selectedConversationId !== "z") && (isReplying || isTaTyping || lastStorySeenRef.current !== latestMessage?.id)
      },
      ...Object.values(displayConversations).map((conversation) => {
        const lastMessage = conversation.messages[conversation.messages.length - 1];
        const articlePreview = conversation.view === "articles" ? conversation.articles?.[0]?.title : undefined;
        return {
          id: conversation.id,
          name: conversation.name,
          subtitle: conversation.subtitle,
          avatarLabel: conversation.avatarLabel,
          preview: articlePreview ?? lastMessage?.displayedText ?? "点开看看有没有新消息",
          time: lastMessage ? formatTime(lastMessage.timestamp) : "刚刚",
          hasUnread:
            conversation.id === "favorite"
              ? favoriteHasUnread
              : conversation.id === "group"
                ? groupHasUnread
                : false
        };
      })
    ];
    return allItems;
  }, [
    displayConversations,
    favoriteHasUnread,
    getStageStatus,
    groupHasUnread,
    latestMessage,
    session.stage, selectedConversationId, isReplying, isTaTyping, conversationVisible
  ]);
  const conversationItems = allConversationItems.filter((item) => `${item.name} ${item.preview} ${item.subtitle}`.toLowerCase().includes(searchKeyword.trim().toLowerCase()));

  const currentConversation = useMemo<ActiveConversation>(() => {
    if (selectedConversationId === "z") {
      return {
        id: "z",
        name: "宝宝",
        subtitle: getStageStatus(session.stage),
        avatarLabel: "宝",
        isStory: true,
        view: "chat" as const,
        articles: [],
        messages: [...session.chatHistory, ...pendingUserMessages]
      };
    }

    const mockConversation = displayConversations[selectedConversationId];
    if (mockConversation) {
      return {
        ...mockConversation,
        isStory: false
      };
    }

    return {
      id: "z",
      name: "宝宝",
      subtitle: getStageStatus(session.stage),
      avatarLabel: "宝",
      isStory: true,
      view: "chat" as const,
      articles: [],
      messages: session.chatHistory
    };
  }, [displayConversations, getStageStatus, pendingUserMessages, selectedConversationId, session.chatHistory, session.stage]);
  const messageTimeBreaks = useMemo(() => {
    const breaks = new Set<string>();
    let previous: ChatMessage | undefined;
    for (const message of currentConversation.messages) {
      if (message.role === "system") continue;
      if (!previous || Math.abs(message.timestamp - previous.timestamp) >= 5 * 60 * 1000) breaks.add(message.id);
      previous = message;
    }
    return breaks;
  }, [currentConversation.messages]);
  const showComposerDisturbance = currentConversation.id === "z" && Boolean(draftWhisper);
  const showHauntingPresence =
    currentConversation.id === "z" &&
    (Boolean(draftWhisper) || (disturbanceLevel >= 3 && session.deletedDrafts.length > 0));

  useLayoutEffect(() => {
    const node = streamRef.current;
    if (!node) {
      return;
    }
    if (lastConversationRef.current !== selectedConversationId) {
      const previousPosition = scrollPositionsRef.current[selectedConversationId];
      followScrollRef.current = previousPosition?.following ?? true;
      node.scrollTop = previousPosition && !previousPosition.following ? previousPosition.top : currentConversation.view === "articles" ? 0 : node.scrollHeight;
    } else if (followScrollRef.current && currentConversation.view !== "articles") node.scrollTop = node.scrollHeight;
    lastConversationRef.current = selectedConversationId;
    const lastMessageId = currentConversation.messages[currentConversation.messages.length - 1]?.id;
    if (!followScrollRef.current && lastMessageIdsRef.current[selectedConversationId] && lastMessageIdsRef.current[selectedConversationId] !== lastMessageId) setHasNewMessages(true);
    lastMessageIdsRef.current[selectedConversationId] = lastMessageId;
  }, [currentConversation.messages, selectedConversationId, chatOpen]);

  useEffect(() => {
    const node = streamRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      // A keyboard or growing draft changes the available height without adding
      // a message. Follow the latest reply only when the reader was at the end.
      if (followScrollRef.current && currentConversation.view !== "articles") node.scrollTop = node.scrollHeight;
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [currentConversation.view]);

  function showSystemToast(
    sourceMessageId: string,
    displayedText: string,
    kind: ChatMessage["kind"] = "warning"
  ) {
    const nextToast: ChatMessage = {
      id: `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: "system",
      displayedText,
      kind,
      timestamp: Date.now()
    };

    seenSystemNoticeIdsRef.current.add(sourceMessageId);
    setSystemToast(nextToast);

    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }

    toastTimerRef.current = window.setTimeout(() => {
      setSystemToast((current) => (current?.id === nextToast.id ? null : current));
      toastTimerRef.current = null;
    }, 3200);
  }

  useEffect(() => {
    if (!hasInitializedSystemNoticeHistoryRef.current) {
      session.chatHistory.forEach((message) => {
        if (message.role === "system" && (message.kind === "warning" || message.kind === "glitch")) {
          seenSystemNoticeIdsRef.current.add(message.id);
        }
      });
      hasInitializedSystemNoticeHistoryRef.current = true;
    }
  }, [session.chatHistory]);

  useEffect(() => {
    if (currentConversation.id !== "z") {
      setSystemToast(null);
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
      return;
    }

    const latestSystemNotice = [...currentConversation.messages]
      .reverse()
      .find((message) => message.role === "system" && (message.kind === "warning" || message.kind === "glitch"));

    if (!latestSystemNotice || seenSystemNoticeIdsRef.current.has(latestSystemNotice.id)) {
      return;
    }

    showSystemToast(latestSystemNotice.id, latestSystemNotice.displayedText, latestSystemNotice.kind);
  }, [currentConversation.id, currentConversation.messages]);

  const locationPending = session.stage === "location_reveal";
  function selectConversation(id: ConversationId) {
    if (phone && !chatOpen) setSearchParams({});
    setMenuOpen(false);
    setComposerPanel(null);
    setHasNewMessages(false);
    setSelectedConversationId(id);
    setRollbackMode(false);
    followScrollRef.current = scrollPositionsRef.current[id]?.following ?? true;
  }
  function backToConversations() {
    inputRef.current?.blur();
    setMenuOpen(false);
    setComposerPanel(null);
    setSearchParams({panel: "list"}, {replace: true});
  }
  function toggleComposerPanel(panel: "emoji" | "more" | "voice") {
    inputRef.current?.blur();
    setComposerPanel(current => current === panel ? null : panel);
  }
  function openSpace() { visitSpace(); navigate("/space"); }
  function handleSend() {
    const nextDraft = draft.trim();
    const isStoryConversation = currentConversation.id === "z";
    const isStoryLocked =
      isStoryConversation &&
      (gameFinished || session.stage === "location_reveal" || session.stage === "location_aftermath");
    const isConversationBusy = isStoryConversation
      ? isStoryLocked
      : mockReplyingConversationId === currentConversation.id;

    if (!nextDraft || isConversationBusy || composingRef.current) {
      return;
    }

    followScrollRef.current = true;
    setHasNewMessages(false);
    if (isStoryConversation) {
      void sendMessage(nextDraft);
      setDraft("");
      return;
    }

    if (selectedConversationId === "z") {
      return;
    }

    const currentConversationId = selectedConversationId;
    const currentMockConversation = mockConversations[currentConversationId];
    if (!currentMockConversation) {
      return;
    }

    const userMessage: ChatMessage = {
      id: `${currentConversation.id}-${Date.now()}-user`,
      role: "user",
      displayedText: nextDraft,
      kind: "normal",
      timestamp: Date.now()
    };

    setMockConversations((current) => ({
      ...current,
      [currentConversationId]: {
        ...current[currentConversationId],
        messages: [...current[currentConversationId].messages, userMessage]
      }
    }));
    setDraft("");

    if (currentConversationId === "assistant" || currentMockConversation.replyPool.length === 0) {
      return;
    }

    const replyText =
      currentMockConversation.replyPool[
        currentMockConversation.messages.length % currentMockConversation.replyPool.length
      ];
    setMockReplyingConversationId(currentConversationId);

    const timer = window.setTimeout(() => {
      setMockConversations((current) => {
        const targetConversation = current[currentConversationId];
        if (!targetConversation) {
          return current;
        }

        const replyMessage: ChatMessage = {
          id: `${currentConversation.id}-${Date.now()}-reply`,
          role: "ta",
          displayedText: replyText,
          kind: "normal",
          timestamp: Date.now()
        };

        return {
          ...current,
          [currentConversationId]: {
            ...targetConversation,
            messages: [...targetConversation.messages, replyMessage]
          }
        };
      });
      setMockReplyingConversationId((current) => (current === currentConversationId ? null : current));
      pendingTimersRef.current = pendingTimersRef.current.filter((id) => id !== timer);
    }, 520);

    pendingTimersRef.current.push(timer);
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !composingRef.current && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
      event.preventDefault();
      handleSend();
    }
  }

  return (
    <main className={`screen desktop-chat-screen${endingTransitionActive ? " ending-transition-screen" : ""}`}>
      <section className={`desktop-chat-shell wx-shell ${chatOpen ? "wx-chat-open" : "wx-list-open"}${endingTransitionActive ? " ending-transition-shell" : ""}`}>
        <aside className="desktop-app-sidebar" aria-label="功能导航">
          <div className="desktop-app-sidebar-top">
            <button className="desktop-app-icon active" type="button" aria-label="聊天" onClick={() => selectConversation("z")}>
              <ChatSidebarIcon />
            </button>
            <button
              className="desktop-app-icon"
              type="button"
              aria-label={getSpaceLabel()}
              title={getSpaceLabel()}
              onClick={() => {
                visitSpace();
                navigate("/space");
              }}
            >
              <SpaceSidebarIcon />
            </button>
          </div>
        </aside>

        <aside className={`desktop-chat-list wx-home wx-tab-${mobileTab}`} aria-hidden={phone && chatOpen ? true : undefined} ref={node => { if (node) node.inert = phone && chatOpen; }}>
          <header className="wx-home-header mobile-only"><h1>{mobileTabs.find(tab => tab.id === mobileTab)?.label}</h1><button type="button" aria-label="搜索聊天" onClick={() => { setMobileTab("chats"); requestAnimationFrame(() => searchRef.current?.focus()); }}><SearchIcon/></button></header>
          <header className="desktop-chat-list-header">
            <label className="desktop-search">
              <span className="desktop-search-icon">
                <SearchIcon />
              </span>
              <input
                ref={searchRef}
                type="search"
                placeholder="搜索"
                aria-label="搜索会话"
                value={searchKeyword}
                onChange={(event) => setSearchKeyword(event.target.value)}
              />
            </label>
          </header>

          <div className="desktop-chat-list-scroll">
            {conversationItems.length === 0 ? <p className="chat-empty-search">没有匹配的会话</p> : null}
            {conversationItems.map((item) => (
              <button
                key={item.id}
                className={`desktop-conversation-item${selectedConversationId === item.id ? " active" : ""}`}
                type="button"
                onClick={() => {
                  selectConversation(item.id);
                }}
              >
                <span className={`desktop-conversation-avatar wx-avatar-${item.id}`}>{item.avatarLabel}{item.hasUnread ? <i className="wx-avatar-unread" aria-label="未读"/> : null}</span>
                <span className="desktop-conversation-body">
                  <span className="desktop-conversation-row">
                    <strong>{item.name}</strong>
                    <span className="desktop-conversation-meta">
                      {item.hasUnread ? <span className="desktop-conversation-unread-dot" aria-label="有新消息" /> : null}
                      <time>{item.time}</time>
                    </span>
                  </span>
                  <span className="desktop-conversation-subtitle">{item.subtitle}</span>
                  <span className="desktop-conversation-preview">{item.preview}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="wx-home-content mobile-only">
            {mobileTab === "contacts" ? <><p className="wx-contact-label">我的联系人</p>{allConversationItems.filter(item => item.id !== "favorite").map(item => <button className="wx-cell" type="button" key={item.id} onClick={() => selectConversation(item.id)}><span className={`desktop-conversation-avatar wx-avatar-${item.id}`}>{item.avatarLabel}</span><span>{item.name}</span></button>)}</> : null}
            {mobileTab === "me" ? <div className="wx-profile"><span className="desktop-conversation-avatar wx-avatar-self">我</span><div><strong>我</strong><p>过拟合恋人</p></div></div> : null}
            {mobileTab === "discover" || mobileTab === "me" ? <>
              <button className="wx-cell" type="button" aria-label="朋友圈" onClick={openSpace}><span className="wx-cell-icon moments"><MobileIcon name="discover"/></span><span>朋友圈</span><span className="wx-chevron">›</span></button>
              <button className="wx-cell" type="button" aria-label="收藏" onClick={() => selectConversation("favorite")}><span className="wx-cell-icon favorites"><MobileIcon name="favorite"/></span><span>收藏</span><span className="wx-chevron">›</span></button>
              <button className="wx-cell" type="button" onClick={() => { selectConversation("z"); setMenuOpen(true); }}><span className="wx-cell-icon"><MobileIcon name="clue"/></span><span>聊天信息</span><span className="wx-chevron">›</span></button>
            </> : null}
          </div>
          <MobileTabBar active={mobileTab} onChange={setMobileTab} unread={allConversationItems.some(item => item.hasUnread)}/>
        </aside>

        <section aria-hidden={phone && !chatOpen ? true : undefined} ref={node => { if (node) node.inert = phone && !chatOpen; }}
          onTouchStart={event => { const touch = event.touches[0]; touchStartRef.current = touch.clientX < 28 ? {x: touch.clientX, y: touch.clientY} : null; }}
          onTouchEnd={event => { const start = touchStartRef.current; const touch = event.changedTouches[0]; touchStartRef.current = null; if (phone && chatOpen && start && touch.clientX - start.x > 80 && Math.abs(touch.clientY - start.y) < 55) backToConversations(); }}
          className={`desktop-chat-main disturbance-${disturbanceLevel}`}>
          {rollbackFlashVisible ? (
            <div
              key={rollbackFlashNonce}
              className="desktop-rollback-flash"
              onAnimationEnd={() => setRollbackFlashVisible(false)}
            />
          ) : null}
          {showHauntingPresence ? (
            <div className={`desktop-haunting-presence disturbance-${disturbanceLevel}`} aria-hidden="true">
              <div className="desktop-haunting-shadow" />
              <div className="desktop-haunting-copy">
                {(hauntingLines.length > 0 ? hauntingLines : ["你删掉的那句还在看着这里。"]).map((line, index) => (
                  <span key={`${line}-${index}`}>{line}</span>
                ))}
              </div>
            </div>
          ) : null}
          <header className={`desktop-chat-header${menuOpen ? " wx-menu-open" : ""}`}>
            <button className="wx-back mobile-only" type="button" aria-label="返回会话列表" onClick={backToConversations}><MobileIcon name="back"/></button>
            <div className="wx-chat-heading">
              <h1 className="desktop-chat-title">{phone && ((currentConversation.isStory && (isReplying || isTaTyping)) || mockReplyingConversationId === currentConversation.id) ? "对方正在输入…" : currentConversation.name}</h1>
              <p className="desktop-chat-subtitle">
                {currentConversation.id === "z" && (isReplying || isTaTyping)
                  ? "对方正在输入中"
                  : currentConversation.id !== "z" && mockReplyingConversationId === currentConversation.id
                    ? "正在输入..."
                    : currentConversation.subtitle}
              </p>
            </div>
            <button className="wx-more mobile-only" type="button" aria-label="聊天信息与操作" aria-expanded={menuOpen} aria-controls="wx-chat-actions" onClick={() => { inputRef.current?.blur(); setComposerPanel(null); setMenuOpen(current => !current); }}><MobileIcon name="more"/></button>
            {menuOpen ? <button className="wx-menu-backdrop mobile-only" type="button" aria-label="关闭聊天菜单" onClick={() => setMenuOpen(false)}/> : null}
            <div id="wx-chat-actions" className="desktop-chat-header-actions" aria-hidden={phone && !menuOpen ? true : undefined} ref={node => { if (node) node.inert = phone && !menuOpen; }}>
              <div className="wx-menu-title mobile-only">聊天信息<button type="button" aria-label="关闭聊天信息" onClick={() => setMenuOpen(false)}>完成</button></div>
              <button className="desktop-header-button mobile-space-button" type="button" onClick={openSpace}>朋友圈</button>
              {currentConversation.isStory && !gameFinished ? (
                <button
                  className={`desktop-header-button${rollbackDisabled ? " rollback-alert" : ""}`}
                  type="button"
                  disabled={isReplying || isTaTyping || endingTransitionActive || session.stage === "location_reveal"}
                  aria-label={
                    rollbackDisabled ? rollbackCopy.buttonDisabledTitle : rollbackMode ? "取消回退模式" : "进入回退模式"
                  }
                  title={rollbackDisabled ? rollbackCopy.buttonDisabledTitle : rollbackMode ? "取消回退模式" : "进入回退模式"}
                  onClick={() => {
                    setMenuOpen(false);
                    if (rollbackDisabled) {
                      setRollbackFlashVisible(true);
                      setRollbackFlashNonce((current) => current + 1);
                      showSystemToast(
                        `blocked-toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                        rollbackCopy.blockedSystemNotice,
                        "glitch"
                      );
                      return;
                    }
                    setRollbackMode((current) => !current);
                  }}
                >
                  {rollbackDisabled ? "读档？" : rollbackMode ? "取消读档" : "读档"}
                </button>
              ) : null}
              {!gameFinished ? <button
                className="desktop-header-button icon windows-close-button"
                type="button"
                disabled={currentConversation.isStory && (isReplying || isTaTyping)}
                aria-label={
                  session.exitClickCount >= 2
                    ? exitCopy.closeButtonTitles.locked
                    : session.exitClickCount >= 1
                      ? exitCopy.closeButtonTitles.warning
                      : exitCopy.closeButtonTitles.default
                }
                title={
                  session.exitClickCount >= 2
                    ? exitCopy.closeButtonTitles.locked
                    : session.exitClickCount >= 1
                      ? exitCopy.closeButtonTitles.warning
                      : exitCopy.closeButtonTitles.default
                }
                onClick={() => {
                  setMenuOpen(false);
                  setShowExitDialog(true);
                }}
              >
                <span className="wx-desktop-close">×</span><span className="mobile-only">退出对话</span>
              </button> : null}
            </div>
          </header>

          {rollbackMode ? <div className="wx-rollback-banner mobile-only">选择一条消息，回到那个时刻<button type="button" onClick={() => setRollbackMode(false)}>取消</button></div> : null}
          <div ref={streamRef} className="desktop-chat-stream" onScroll={(event) => { const node = event.currentTarget; followScrollRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80; if (followScrollRef.current) setHasNewMessages(false); if (conversationVisible) scrollPositionsRef.current[selectedConversationId] = {top: node.scrollTop, following: followScrollRef.current}; }}>
            {currentConversation.view === "articles" ? (
              <section
                className={`favorite-article-feed favorite-article-feed-${currentConversation.id === "favorite" ? favoriteCollectionTone : "normal"}`}
                aria-label="收藏文章列表"
              >
                {currentConversation.articles?.map((article: NonNullable<MockConversation["articles"]>[number]) => (
                  <article
                    key={article.id}
                    className={`favorite-article-card favorite-article-card-${currentConversation.id === "favorite" ? favoriteCollectionTone : "normal"}`}
                  >
                    <header className="favorite-article-header">
                      <div className="favorite-article-source">
                        <span className="favorite-article-avatar">{article.source.slice(0, 1)}</span>
                        <strong>{article.source}</strong>
                      </div>
                      <div className="favorite-article-meta">
                        <span>{article.meta}</span>
                        {article.tag ? <span>{article.tag}</span> : null}
                      </div>
                    </header>
                    <h2 className="favorite-article-title">{article.title}</h2>
                    {expandedArticles.includes(article.id) ? <p id={`article-${article.id}`} className="favorite-article-summary">{article.summary}</p> : null}
                    <footer className={`favorite-article-footer favorite-article-footer-${currentConversation.id === "favorite" ? favoriteCollectionTone : "normal"}`}>
                      <span>公众号文章</span>
                      <button type="button" aria-expanded={expandedArticles.includes(article.id)} aria-controls={`article-${article.id}`} aria-label={`查看：${article.title}`} onClick={() => {
                        setExpandedArticles((current) => current.includes(article.id) ? current.filter((id) => id !== article.id) : [...current, article.id]);
                      }}>{expandedArticles.includes(article.id) ? "收起" : "查看"}</button>
                    </footer>
                  </article>
                ))}
              </section>
            ) : (
              <>
                {currentConversation.messages.map((message, index) => {
              const previousRole = index > 0 ? currentConversation.messages[index - 1]?.role : null;
              const grouped = previousRole === message.role;

              if (message.kind === "space_notice") {
                return (
                  <article key={message.id} className="desktop-space-notice-row wx-space-notice">
                    <div className="desktop-space-notice-card">
                      <div className="desktop-space-notice-badge">朋友圈提醒</div>
                      <strong className="desktop-space-notice-title">{currentConversation.name}刚刚更新了朋友圈</strong>
                      <p className="desktop-space-notice-copy">{message.displayedText.replace(/^.*(?:空间|朋友圈)：/, "")}</p>
                      <button className="desktop-message-rollback" type="button" onClick={() => {visitSpace(); navigate("/space");}}>查看朋友圈</button>
                      <time className="desktop-space-notice-time">{formatTime(message.timestamp)}</time>
                    </div>
                  </article>
                );
              }

              if (message.kind === "location_notice") {
                return (
                  <article key={message.id} className="desktop-space-notice-row">
                    <div className="desktop-space-notice-card">
                      <div className="desktop-space-notice-badge">定位共享</div>
                      <button
                        className="desktop-message-rollback"
                        type="button"
                        disabled={session.stage !== "location_reveal"}
                        onClick={() => navigate("/location")}
                      >
                        {session.stage === "location_reveal" ? "打开定位" : "已查看定位"}
                      </button>
                      <time className="desktop-space-notice-time">{formatTime(message.timestamp)}</time>
                    </div>
                  </article>
                );
              }

              if (message.role === "system") {
                return null;
              }

              const isMonitorImage = message.kind === "monitor_image" && Boolean(message.mediaUrl);

              const showTime = messageTimeBreaks.has(message.id);
              return (
                <Fragment key={message.id}>
                {showTime ? <time className="wx-time-divider mobile-only">{formatTime(message.timestamp)}</time> : null}
                <article
                  className={`desktop-message-row ${message.role}${grouped ? " is-grouped" : ""}`}
                >
                  {message.role !== "user" ? (
                    <span className={`desktop-message-avatar ${message.role} wx-avatar-${selectedConversationId}`}>
                      {message.role === "ta" ? currentConversation.avatarLabel : "系"}
                    </span>
                  ) : null}

                  {message.role === "user" && message.kind === "pending" ? (
                    <span className="desktop-message-pending-spinner" aria-label="等待发送" />
                  ) : null}

                  <div className={`desktop-message-stack ${message.role}`}>
                    <div className={`desktop-message-bubble ${message.role}${isMonitorImage ? " media" : ""}`}>
                      {isMonitorImage ? (
                        <img
                          className="desktop-message-media"
                          src={message.mediaUrl}
                          alt={message.displayedText}
                          loading="lazy"
                          onLoad={() => { if (followScrollRef.current && streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight; }}
                        />
                      ) : (
                        <span>{message.displayedText}</span>
                      )}
                    </div>
                    {currentConversation.isStory && rollbackMode && message.kind !== "pending" ? (
                      <button
                        className="desktop-message-rollback"
                        type="button"
                        disabled={isReplying || isTaTyping || rollbackDisabled}
                        onClick={() => {
                          const confirmed = window.confirm("你是否要回退到当前版本？");
                          if (!confirmed) {
                            return;
                          }
                          try {
                            rollbackToMessage(message.id);
                          } catch (error) {
                            window.alert(error instanceof Error ? error.message : rollbackCopy.limitError);
                            return;
                          }
                          setRollbackMode(false);
                        }}
                      >
                        回退到这里
                      </button>
                    ) : null}
                    <time className="desktop-message-time">{formatTime(message.timestamp)}</time>
                  </div>

                  {message.role === "user" ? <span className="desktop-message-avatar user">我</span> : null}
                </article>
                </Fragment>
              );
                })}
              </>
            )}
            {currentConversation.isStory && gameFinished ? <section className="game-ending" aria-label="故事结局">
              <h2>梦醒</h2>
              {storyCopy.wakeLines.map((line) => <p key={line}>{line}</p>)}
              <button type="button" onClick={resetForReplay}>重新开始这段故事</button>
              <small>本作的聊天、定位与工作群均为虚构。没有读取真实通讯录、定位或其他应用。</small>
            </section> : null}
          </div>

          {systemToast ? (
            <div key={systemToast.id} className="desktop-system-toast" role="status" aria-live="polite">
              <span className="desktop-system-toast-badge">系</span>
              <span className="desktop-system-toast-copy">{systemToast.displayedText}</span>
            </div>
          ) : null}

          {showExitDialog ? (
            <div className="desktop-overlay-backdrop" role="presentation" onClick={() => setShowExitDialog(false)}>
              <div
                className="desktop-exit-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="exit-dialog-title"
                onClick={(event) => event.stopPropagation()}
              >
                <h2 id="exit-dialog-title" className="desktop-exit-dialog-title">
                  {exitDialogTitle}
                </h2>
                <p className="desktop-exit-dialog-body">{exitDialogBody}</p>
                <div className="desktop-exit-dialog-actions">
                  <button
                    className="desktop-header-button"
                    type="button"
                    onClick={() => {
                      setShowExitDialog(false);
                      selectConversation("z");
                      if (!gameFinished) void exitAttempt();
                    }}
                  >
                    {exitCopy.confirmLabel}
                  </button>
                  <button
                    className="desktop-header-button"
                    type="button"
                    onClick={() => setShowExitDialog(false)}
                  >
                    {exitCopy.stayLabel}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {hasNewMessages && currentConversation.view !== "articles" ? <button className="wx-new-messages" type="button" onClick={() => { followScrollRef.current = true; streamRef.current?.scrollTo({top: streamRef.current.scrollHeight, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches || streamRef.current.scrollHeight - streamRef.current.scrollTop - streamRef.current.clientHeight > streamRef.current.clientHeight * 2 ? "auto" : "smooth"}); setHasNewMessages(false); }}>↓ 新消息</button> : null}
          {currentConversation.view !== "articles" && !(gameFinished && currentConversation.isStory) ? (
            <footer className={`desktop-chat-composer disturbance-${disturbanceLevel}`}>
            <div className={`desktop-composer-editor${draft.trim() ? " wx-has-draft" : ""}`}>
              <button className="wx-composer-icon mobile-only" type="button" aria-label="输入方式" aria-expanded={composerPanel === "voice"} onClick={() => toggleComposerPanel("voice")}><MobileIcon name={composerPanel === "voice" ? "keyboard" : "voice"}/></button>
              <div
                className={`desktop-composer-input-wrap disturbance-${disturbanceLevel}${showComposerDisturbance ? " has-warning" : ""}`}
              >
                {showComposerDisturbance ? (
                  <div className={`desktop-composer-alert disturbance-${Math.max(disturbanceLevel, draftPauseLevel)}`}>
                    <strong>异常</strong>
                    <span>{composerWarning}</span>
                  </div>
                ) : null}
                {showComposerDisturbance ? (
                  <div className={`desktop-input-undercurrent disturbance-${Math.max(disturbanceLevel, draftPauseLevel)}`} aria-hidden="true">
                    <span>{disturbanceCopy || "你删掉的那句还在后面。"}</span>
                    <span>{disturbanceCopy || "你删掉的那句还在后面。"}</span>
                  </div>
                ) : null}
                <textarea
                  ref={inputRef}
                  className="desktop-chat-input"
                  rows={1}
                  enterKeyHint="send"
                  autoComplete="off"
                  onCompositionStart={() => { composingRef.current = true; }}
                  onCompositionEnd={() => { composingRef.current = false; }}
                  onFocus={() => { setComposerPanel(null); }}
                  onBlur={() => { if (latestUiRef.current) writeChatUi(latestUiRef.current); }}
                  aria-label={`给${currentConversation.name}发消息`}
                  placeholder={currentConversation.isStory && session.stage === "location_reveal" ? "先打开上方的定位消息…" : phone ? "" : `给${currentConversation.name}发消息`}
                  disabled={
                    currentConversation.id === "z"
                      ? session.stage === "location_reveal" || session.stage === "location_aftermath"
                      : mockReplyingConversationId === currentConversation.id
                  }
                  value={draft}
                  onKeyDown={handleInputKeyDown}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    const nativeEvent = event.nativeEvent as InputEvent;
                    const inputType = typeof nativeEvent.inputType === "string" ? nativeEvent.inputType : "";
                    const isDeleting =
                      inputType === "deleteContentBackward" || inputType === "deleteContentForward";

                    if (currentConversation.isStory) updateDraft(draft, nextValue, {
                      isDeleting,
                      deletionType:
                        inputType === "deleteContentBackward" || inputType === "deleteContentForward"
                          ? inputType
                          : "",
                      isComposing: Boolean(nativeEvent.isComposing)
                      ,
                      timestamp: Date.now()
                    });
                    setDraft(nextValue);
                  }}
                />
                <span className="desktop-enter-hint">Enter 发送</span>
                {currentConversation.id === "z" && draftWhisper ? (
                  <div className={`desktop-draft-whisper level-${draftPauseLevel}`}>
                    <span>{draftWhisper}</span>
                    {draftEditCount >= 2 ? <small>这一句已经被改了 {draftEditCount} 次。</small> : null}
                  </div>
                ) : null}
              </div>
              <button className="wx-composer-icon mobile-only" type="button" aria-label="表情" aria-expanded={composerPanel === "emoji"} onClick={() => toggleComposerPanel("emoji")}><MobileIcon name={composerPanel === "emoji" ? "keyboard" : "smile"}/></button>
              <button className="wx-composer-icon wx-add mobile-only" type="button" aria-label="更多功能" aria-expanded={composerPanel === "more"} onClick={() => toggleComposerPanel("more")}><MobileIcon name="plus"/></button>
              <button
                className="desktop-send-button"
                type="button"
                disabled={!draft.trim() || (
                  currentConversation.id === "z"
                    ? session.stage === "location_reveal" || session.stage === "location_aftermath"
                    : mockReplyingConversationId === currentConversation.id
                )}
                onPointerDown={event => { if (document.activeElement === inputRef.current) event.preventDefault(); }}
                onClick={handleSend}
              >
                {currentConversation.id === "z"
                  ? "发送"
                  : mockReplyingConversationId === currentConversation.id
                    ? "发送中"
                    : "发送"}
              </button>
            </div>
            {composerPanel ? <div className={`wx-composer-panel wx-panel-${composerPanel} mobile-only`}>
              {composerPanel === "emoji" ? <div className="wx-emoji-grid">{["😊", "😂", "🥺", "🥰", "❤️", "👍", "🤔", "😅", "😭", "😴", "👀", "🙃", "😳", "🤫", "🌙", "🌷", "抱抱", "晚安"].map(emoji => <button key={emoji} type="button" aria-label={`插入${emoji}`} onClick={() => { const next = draft + emoji; if (currentConversation.isStory) updateDraft(draft, next); setDraft(next); }}>{emoji}</button>)}</div> : null}
              {composerPanel === "more" ? <div className="wx-more-grid"><button type="button" onClick={openSpace}><span><MobileIcon name="discover"/></span>朋友圈</button><button type="button" onClick={() => selectConversation("favorite")}><span><MobileIcon name="favorite"/></span>收藏</button><button type="button" onClick={() => { setComposerPanel(null); setMenuOpen(true); }}><span><MobileIcon name="clue"/></span>聊天信息</button>{locationPending ? <button type="button" onClick={() => navigate("/location")}><span><MobileIcon name="location"/></span>位置</button> : null}</div> : null}
              {composerPanel === "voice" ? <div className="wx-voice-note"><MobileIcon name="voice"/><p>这段故事通过文字对话继续。</p><button type="button" onClick={() => { setComposerPanel(null); inputRef.current?.focus({preventScroll:true}); }}>继续打字</button></div> : null}
            </div> : null}
            </footer>
          ) : null}
        </section>
        {endingTransitionActive ? (
          <div className="ending-transition-overlay" aria-hidden="true">
            <span className="ending-transition-wave ending-transition-wave-primary" />
            <span className="ending-transition-wave ending-transition-wave-secondary" />
            <span className="ending-transition-vignette" />
          </div>
        ) : null}
      </section>
    </main>
  );
}
