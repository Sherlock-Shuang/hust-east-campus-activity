import type { SessionState } from "../../types/session";
import type { StoryEvent, TriggerReason } from "../../types/story";
import { fallbackReplyCopy } from "../../config/hardcodedCopy";

function chooseByCount(
  pool: {
    one: readonly string[];
    two: ReadonlyArray<readonly [string, string]>;
  },
  desiredReplyLineCount: 1 | 2,
): string[] {
  if (desiredReplyLineCount === 1) {
    if (pool.one.length === 0) {
      return [fallbackReplyCopy.defaults.one];
    }

    const index = Math.floor(Math.random() * pool.one.length);
    return [pool.one[index] ?? fallbackReplyCopy.defaults.one];
  }

  const index = Math.floor(Math.random() * pool.two.length);
  const pair = pool.two[index] ?? fallbackReplyCopy.defaults.two;
  return [...pair];
}

function isFinalEntityStage(stage: SessionState["stage"]): boolean {
  return stage === "location_aftermath" || stage === "meta_break" || stage === "truth_reveal" || stage === "wake_up";
}

const fixedPollutedReplyMap = {
  "我不爱你了": fallbackReplyCopy.keywords["没事"],
  "我觉得你又胖又丑": fallbackReplyCopy.keywords["随便"],
  "我现在更想一个人": fallbackReplyCopy.keywords["都行"],
  "别吵我，我要去打游戏了": fallbackReplyCopy.keywords["算了"],
  行: fallbackReplyCopy.keywords["不用"],
} as const;

function getFixedPollutionReplyPoolByText(pollutedText?: string) {
  const normalizedText = pollutedText?.trim() as keyof typeof fixedPollutedReplyMap | undefined;
  return normalizedText ? fixedPollutedReplyMap[normalizedText] : undefined;
}

export function getFallbackReply(
  session: SessionState,
  desiredReplyLineCount: 1 | 2,
  triggerKeyword?: string,
  triggerReason?: TriggerReason,
  events: StoryEvent[] = []
): string[] {
  if (events.includes("load_restored")) {
    return chooseByCount(fallbackReplyCopy.events.load_restored, desiredReplyLineCount);
  }

  if (events.includes("load_failed")) {
    return chooseByCount(fallbackReplyCopy.events.load_failed, desiredReplyLineCount);
  }

  if (events.includes("load_warning")) {
    return chooseByCount(fallbackReplyCopy.events.load_warning, desiredReplyLineCount);
  }

  if (events.includes("draft_exposed")) {
    return chooseByCount(fallbackReplyCopy.events.draft_exposed, desiredReplyLineCount);
  }

  if (events.includes("hesitation_noticed")) {
    return chooseByCount(fallbackReplyCopy.events.hesitation_noticed, desiredReplyLineCount);
  }

  if (events.includes("space_glitch")) {
    return chooseByCount(fallbackReplyCopy.events.space_glitch, desiredReplyLineCount);
  }

  if (events.includes("exit_blocked")) {
    return chooseByCount(fallbackReplyCopy.events.exit_blocked, desiredReplyLineCount);
  }

  if (triggerReason === "keyword" && triggerKeyword && fallbackReplyCopy.keywords[triggerKeyword as keyof typeof fallbackReplyCopy.keywords]) {
    return chooseByCount(
      fallbackReplyCopy.keywords[triggerKeyword as keyof typeof fallbackReplyCopy.keywords],
      desiredReplyLineCount
    );
  }

  if ((triggerReason === "count" || triggerReason === "scripted") && session.pollutionCount > 0 && session.pollutionCount <= 5) {
    const lastPollutedText = session.pollutedInputs[session.pollutedInputs.length - 1];
    const fixedReplyPool = getFixedPollutionReplyPoolByText(lastPollutedText);
    if (fixedReplyPool) {
      return chooseByCount(fixedReplyPool, desiredReplyLineCount);
    }
  }

  if (session.pollutionCount > 5 && isFinalEntityStage(session.stage)) {
    return chooseByCount(fallbackReplyCopy.finalEntityReplies, desiredReplyLineCount);
  }

  if (session.pollutionCount > 5) {
    return chooseByCount(fallbackReplyCopy.postThresholdChaos, desiredReplyLineCount);
  }

  if (triggerReason === "keyword") {
    return chooseByCount(fallbackReplyCopy.triggerReason.keyword, desiredReplyLineCount);
  }

  if (triggerReason === "count" || triggerReason === "scripted") {
    return chooseByCount(
      session.pollutionCount >= 5
        ? fallbackReplyCopy.triggerReason.latePollution
        : fallbackReplyCopy.triggerReason.earlyPollution,
      desiredReplyLineCount
    );
  }

  if (triggerReason === "timed") {
    return chooseByCount(fallbackReplyCopy.triggerReason.timed, desiredReplyLineCount);
  }

  switch (session.stage) {
    case "intro":
      return chooseByCount(fallbackReplyCopy.stage.intro, desiredReplyLineCount);
    case "normal_chat":
      return chooseByCount(fallbackReplyCopy.stage.normal_chat, desiredReplyLineCount);
    case "draft_exposed":
      return chooseByCount(fallbackReplyCopy.stage.draft_exposed, desiredReplyLineCount);
    case "first_pollution":
      return chooseByCount(
        session.pollutionCount >= 5
          ? fallbackReplyCopy.stage.first_pollution_late
          : fallbackReplyCopy.stage.first_pollution_early,
        desiredReplyLineCount
      );
    case "save_loaded_once":
    case "save_loaded_twice":
      return chooseByCount(fallbackReplyCopy.stage.save_loaded, desiredReplyLineCount);
    default:
      return chooseByCount(fallbackReplyCopy.stage.default, desiredReplyLineCount);
  }
}
