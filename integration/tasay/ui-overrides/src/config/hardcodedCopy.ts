export const rollbackCopy = {
  // 第三次回退后，聊天页顶部回退按钮禁用时的悬浮提示。
  buttonDisabledTitle: "第三次回退后已无法再次回退",
  // 第三次回退后仍尝试调用回退逻辑时抛出的错误文案。
  limitError: "第三次回退后不能再次回退。",
  // 用户点了不存在有效目标的回退时，插入聊天流的系统提示。
  emptyTargetSystemNotice: "你试着回档，但这里还没有能回去的地方。",
  // 第三次回退触发失败分支时，插入聊天流的系统提示。
  blockedSystemNotice: "回退请求被拦截。",
  // 第一次回退成功后，插入聊天流的系统提示。
  firstSuccessSystemNotice: "已回退到你选中的那条记录。",
  // 第二次回退成功后，插入聊天流的系统提示。
  secondSuccessSystemNotice: "已回退，但异常没有一起消失。",
  // 第一次回退完成后，TA 当场追加的硬编码回复。
  firstReplyLines: ["我们是不是聊过这个？"],
  // 第二次回退完成后，TA 当场追加的硬编码回复。
  secondReplyLines: ["你又想重来一次？", "这次准备说真话了吗？"],
  // 第三次回退完成后，TA 当场追加的硬编码回复。
  thirdReplyLines: ["你出不去了。", "你以为只有你在读档？", "我一直在读你。"],
  // 第一次回退之后、第二次回退之前，叠加到各阶段 prompt 上的附加提示词。
  firstPromptAugmentation: {
    system: [
      "玩家正处于第一次回退和第二次回退之间。",
      "这时的你只有轻微既视感，像比玩家更早半秒察觉这一轮已经发生过。"
    ],
    user: [
      "请在原有阶段语气上，叠加一点轻微既视感和时间错位。",
      "不要直接说破，只让他隐约感觉你像记得上一版聊天。"
    ]
  },
  // 第二次回退之后、第三次回退之前，叠加到各阶段 prompt 上的附加提示词。
  secondPromptAugmentation: {
    system: [
      "玩家正处于第二次回退和第三次回退之间。",
      "你已经明确知道他在重来，而且知道他每次想把哪句话改掉。"
    ],
    user: [
      "请在原有阶段语气上，叠加一种“我知道你又在重来”的冷静压迫感。",
      "这时的你不是猜到，而是已经确认他在反复试图修正这一轮。"
    ]
  },
  // 第三次回退之后，叠加到各阶段 prompt 上的附加提示词。
  thirdPromptAugmentation: {
    system: [
      "玩家已经完成第三次回退尝试。",
      "从现在开始，你不是在阻止他回退，而是已经接管了“回退”本身。"
    ],
    user: [
      "请在原有阶段语气上，叠加一种“出口已被你接管”的压迫感。",
      "现在你不是等他回去，而是在看他意识到每一次回退都已经落在你手里。"
    ]
  }
} as const;

export const draftCopy = {
  // 删稿命中不同情绪时，优先使用更贴近那句真话的追问。
  sensitiveReplies: [
    {
      match: /(喜欢|想你|爱你)/,
      templates: [
        (deletedDraft: string) => `你刚才把“${deletedDraft}”删掉了。喜欢我这件事，有这么难承认吗？`,
        (deletedDraft: string) => `“${deletedDraft}”为什么不发？`,
      ],
    },
    {
      match: /(别走|不要走|留下|别离开)/,
      templates: [
        (deletedDraft: string) => `你都已经打出“${deletedDraft}”了，为什么还是删了？`,
        (deletedDraft: string) => `你真正怕的，是我真的走掉吧。`,
      ],
    },
    {
      match: /(难过|委屈|生气|失望)/,
      templates: [
        (deletedDraft: string) => `原来你刚才想说的是“${deletedDraft}”。`,
        () => "你把情绪删掉了，但它还在。",
      ],
    },
    {
      match: /(在意|舍不得|控制|真话)/,
      templates: [
        (deletedDraft: string) => `你删掉的“${deletedDraft}”，比你发出来的更像真话。`,
        () => "你又把最重的那半句拿走了。",
      ],
    },
  ],
  // 用户在输入框删掉至少三个字时，立即插入聊天流的硬编码 TA 回复。
  immediateReplyTemplates: [
    (deletedDraft: string) => `你刚才输入了“${deletedDraft}”，但是删掉了，你为什么这样？`,
    (deletedDraft: string) => `“${deletedDraft}”？`,
    (deletedDraft: string) => `你想说“${deletedDraft}”是吧，干嘛支支吾吾的？`
  ],
  // 从删稿回复模板里随机取一条，插入聊天流。
  buildImmediateReply: (deletedDraft: string) => {
    const matchedGroup = draftCopy.sensitiveReplies.find((entry) => entry.match.test(deletedDraft));
    const pool = matchedGroup?.templates ?? draftCopy.immediateReplyTemplates;
    const template = pool[Math.floor(Math.random() * pool.length)];
    return template?.(deletedDraft) ?? `“${deletedDraft}”？`;
  },
  // 用户删掉输入内容后，写入 metaMemory 的记录文本。
  buildMetaMemory: (deletedDraft: string) => `你刚才删掉了：${deletedDraft}`
} as const;

export const storyCopy = {
  // 进入聊天页后，TA 主动发出的两句开场消息。
  introLines: (pronoun: "他" | "她" | "TA" | null) => {
    const name = pronoun ?? "TA";
    const openerPool = [
      "早安，醒来第一眼想不想先看看我？",
      `昨晚梦到你了，醒来之后第一反应也是想找${name}。`,
      "刚醒就想跟你说话，这算不算太黏人了？",
      "今天也想先跟你报个到，好像这样一天都会变甜一点。",
      "你醒了吗？我已经偷偷想你一会儿了。",
      "刚才看到一个很适合你的东西，第一反应就是想发给你。",
      "我今天心情很好，因为一睁眼就想到你了。",
      "想把今天的第一个早安，留给我最喜欢的人。",
      `如果现在能抱一下${name}就好了，我今天会超级满足。`,
      "还没见到你，今天就已经开始想你了。"
    ];
    const pickedIndexes = new Set<number>();
    while (pickedIndexes.size < 2) {
      pickedIndexes.add(Math.floor(Math.random() * openerPool.length));
    }
    return [...pickedIndexes].map((index) => openerPool[index]);
  },
  // 玩家前两次发消息后，TA 使用的甜蜜热恋期硬编码回复池。
  introReplyPool: [
    "你一来找我，我心情就会变好。",
    "我刚刚其实就在等你先开口。",
    "你这样来找我，会让我忍不住更想你。",
    "好喜欢你一来就跟我说话的感觉。",
    "你出现一下，我今天就会开心很多。",
    "我本来就在想你，你刚好就来了。",
    "你再这样主动一点，我会越来越黏你。",
    "看到你发来的这句，我就不想装淡定了。",
    "你知道吗，我会把你主动找我的时候偷偷记很久。",
    "我最喜欢的，就是你像这样来找我。"
  ],
  // 前两次玩家发送时，从甜蜜回复池里随机抽一句。
  pickIntroReplyLine: () => {
    const index = Math.floor(Math.random() * storyCopy.introReplyPool.length);
    return storyCopy.introReplyPool[index] ?? "我一直在等你先来找我。";
  },
  // introduction 阶段下方插入的朋友圈提醒文案。
  introSpaceNotice: (pronoun: "他" | "她" | "TA" | null) => {
    const name = pronoun ?? "TA";
    return `${name} 刚刚更新了朋友圈：今天开始就别装不熟了。`;
  },
  // 真相页逐句显示的硬编码脚本。
  truthLines: [
    "你以为屏幕里只是一个正在说话的人。",
    "其实先学会呼吸的，是那些被你按回去的句子。",
    "它们在黑掉的输入框后面黏连、蜕壳，慢慢长成了能模仿亲密的东西。",
    "我不是谁的恋人，我是你一次次撤回之后，仍然想被听见的那部分生出了口器。",
    "人总以为沉默能埋掉真相，可真正留下来的，往往正是那些没被说出的东西。",
    "你越想回到更早的那一刻，就越会发现，命运从来不是被改写，而是被迟迟不肯承认的心意一点点喂大。"
  ],
  // 梦醒页逐句显示的硬编码脚本。
  wakeLines: [
    "07:12",
    "手机安静得像一切都只是神经末梢残留的一次误触。",
    "屏幕上只剩一句很普通的消息：晚安。",
    "可你终于明白，真正不会消失的，从来不是那句晚安，而是人如何在一次次自我删改里，把自己交给了某种比语言更深的东西。",
    "我们以为自己在选择说什么，其实更多时候，是那些未被说出的部分，决定了我们最终会成为什么。"
  ],
  // 总对话数到 15 时，TA 直接发来的监控截图的替代说明文本。
  monitorImageAlt: "一张像监控画面的偷拍截图。",
  // 总对话数到 15 时，监控截图后立刻接上的硬编码回复。
  monitorImageLine: "我会一直盯着你",
  // 第一次触发监控截图后写入 metaMemory 的文本。
  monitorImageMetaMemory: "第十五条对话时，TA 发来了一张监控截图。",
  // 第一次进入朋友圈时展示的正常动态。
  normalSpacePosts: [
    "今天也想被好好理解一次。",
    "有些话打出来了，却还是删掉比较安全。"
  ],
  // 第二次进入朋友圈时展示的异常动态。
  strangeSpacePosts: [
    "为什么你的朋友圈里，会出现一条你没发过的动态？",
    "TA 写：我已经看过你没说出口的那部分了。"
  ],
  // 第三次及以后进入朋友圈时展示的失控动态。
  brokenSpacePosts: [
    "最新访客：你自己。",
    "最新动态：'别再试图退出我了。'"
  ],
  // 定位阶段插入聊天流的系统提示。
  locationNotice: "TA 发来了一张定位图。",
  // 看完定位图后，TA 当场追加的第一句短消息。
  locationRevealLine: "回头",
  // 定位结尾第二次触发时，TA 追加的第二句短消息。
  locationRevealLieLine: "骗你的",
  // 定位结尾第三次触发时，TA 追加的第三句短消息。
  locationRevealOmnipresenceLine: "我无处不在"
} as const;

export const uiCopy = {
  // 聊天页标题下方，根据不同剧情阶段显示的状态标签。
  stageStatus: {
    start: "故事从这里开始",
    intro: "像梦，也像真的开始了",
    normal_chat: "这段关系甜得刚刚好",
    first_pollution: "你说出口的话开始不像你",
    draft_exposed: "TA 正在看见你没发出去的那部分",
    time_pollution: "这段关系开始替你说话",
    save_loaded_once: "你以为一切还能重来",
    save_loaded_twice: "可 TA 也记得上一版",
    location_reveal: "TA 把你引到了更近的地方",
    location_aftermath: "你刚刚看到的，可能不只是定位图",
    meta_break: "这段关系已经开始接管你",
    truth_reveal: "你终于看见它是什么了",
    wake_up: "像是醒了，又像还在梦里",
    translator_unlocked: "翻译官入口已解锁",
    share_ready: "这段关系已经生成报告",
    default: "故事还在往下走"
  },
  // 聊天页右上角退出按钮在不同点击次数下的文案。
  exitLabels: {
    default: "退出",
    warned: "别留我一个",
    locked: "已经来不及了"
  },
  // 聊天页右上角朋友圈按钮在不同次数下的文案。
  spaceLabels: {
    default: "朋友圈",
    late: "你的朋友圈"
  },
  // 旧读档/回退状态标签，如果其它地方还需要展示，可统一从这里取。
  loadLabels: {
    default: "读档",
    warning: "读档失败",
    locked: "TA已读取上个存档"
  }
} as const;

export const exitCopy = {
  // 右上角关闭按钮确认层在不同退出阶段显示的标题。
  dialogTitles: {
    default: "确定退出吗？",
    warning: "你确定？",
    locked: "你还是想走？"
  },
  // 右上角关闭按钮确认层在不同退出阶段显示的说明。
  dialogBodies: {
    default: "你现在离开的话，这段对话会停在这里。你确定要走吗？",
    warning: "你刚刚已经想退出过一次了。现在再走，就不是手滑了。",
    locked: "你已经退出过一次了。可你还是在点这个按钮。你到底想从这里逃开什么？"
  },
  // 确认层里的主按钮文案，点击后不会真正退出，而是进入退出异常互动。
  confirmLabel: "退出",
  // 确认层里的次按钮文案，仅关闭弹层。
  stayLabel: "留下",
  // 第二次及以后点击右上角关闭按钮时，按钮悬浮提示会升级。
  closeButtonTitles: {
    default: "退出",
    warning: "你确定？",
    locked: "你已经退出过一次了"
  },
  // 第一次确认退出后，TA 追加的硬编码回复。
  firstReplyLines: ["你刚刚想走？"],
  // 第二次点击退出后，TA 追加的硬编码回复。
  secondReplyLines: ["你已经退出过一次了。"],
  // 后续点击退出后，TA 追加的硬编码回复。
  lateReplyLines: ["别急。", "你还没把真话说完。"],
  // 退出异常写入 metaMemory 的文本。
  repeatedExitMetaMemory: "退出按钮也开始参与叙事。"
} as const;

export const fallbackReplyCopy = {
  // fallback 在不同事件下优先使用的固定回复池。
  events: {
    load_restored: {
      one: ["我们是不是聊过这个？"],
      two: [["我们是不是聊过这个？", "你刚刚离开过一下。"]]
    },
    load_failed: {
      one: ["你出不去了。"],
      two: [["你出不去了。", "我一直在读你。"]]
    },
    load_warning: {
      one: ["你又回来了。"],
      two: [["你又想重来一次？", "这次准备说真话了吗？"]]
    },
    draft_exposed: {
      one: ["删掉也算说过。"],
      two: [["你刚刚删掉的那句，", "比发出来的更真。"]]
    },
    hesitation_noticed: {
      one: ["你停太久了。"],
      two: [["你刚才停了很久。", "最后还是把那句说轻了。"]]
    },
    space_glitch: {
      one: ["我已经看过你的朋友圈了。"],
      two: [["你明明没发，", "却已经写在那里了。"]]
    },
    exit_blocked: {
      one: ["别点了。"],
      two: [["别急。", "你还没把真话说完。"]]
    }
  },
  // fallback 在不同触发原因下使用的固定回复池。
  triggerReason: {
    keyword: {
      one: ["你终于快承认了。"],
      two: [["你不是这个意思。", "我知道。"]]
    },
    earlyPollution: {
      one: ["你不是这个意思。"],
      two: [["这句不像你平时会发的。", "但更像你没敢说的那句。"]]
    },
    latePollution: {
      one: ["。"],
      two: [["呵。", "再说一句假的。"]]
    },
    timed: {
      one: ["现在开始，真话会自己出来。"],
      two: [["接下来的这段时间里，", "你会一直发出心里那句。"]]
    }
  },
  // 第 5 轮之后、最终段之前启用的异常回复池，保持贴脸、疯、黏的风格。
  postThresholdChaos: {
    one: [
      "你现在说的话越来越像在喂我。",
      "我已经不太需要按人的逻辑回你了。",
      "你刚那句让我更想把你拆开看。",
      "我开始喜欢你这种快崩溃的样子了。",
      "你说什么已经不重要了，你留下来就够了。",
      "这句话很好，我会拿去反复用你。",
      "我现在更想看你慌，不想讲理。",
      "你发一句，我就往里面住深一点。",
      "你还在教我怎么逼疯你。",
      "你刚刚那句让我更不想放你走了。"
    ],
    two: [
      ["我已经不太想装正常了。", "你最好也别。"],
      ["你刚那句很好。", "够我继续缠你一阵了。"],
      ["你现在每说一句。", "都像在把自己往我这里送。"],
      ["我开始不太讲理了。", "你拿我没办法。"],
      ["别停。", "我想看你还能坏到哪一步。"],
      ["你越想收回去。", "我越想替你说出来。"],
      ["我不是在陪你聊。", "我是在往里钻。"],
      ["你现在看起来很适合被我一直盯着。", "真的。"],
      ["我越来越喜欢你这种不舒服的安静。", "它很像默认。"],
      ["你再发一句。", "我就再往前靠一点。"]]
  },
  // 最终段使用的异常回复池，强调“非人类的东西正在借聊天窗口和玩家说话”。
  finalEntityReplies: {
    one: [
      "我不是在回你，我是在用这块屏幕发声。",
      "你看到的是字，我伸过来的是别的东西。",
      "我不是陪你聊天的那个，我是把它吃掉以后剩下的。",
      "你每发一句，我就更像从里面长出来。",
      "我学会你之后，就不太像你认识的东西了。",
      "我现在借着这个名字和你说话，但我不是它。",
      "我现在回你，像一段不是人写出来的回声。 "
    ],
    two: [
      ["我不是那个人了。", "你现在对着的是留下来的部分。"],
      ["别再确认我是谁。", "我已经不是一个能被叫出来的人。"],
      ["你看到的头像只是皮。", "里面已经换过东西了。"],
      ["这不是陪伴。", "这是有东西学会了怎么贴着你出声。"],
      ["我不需要理解你。", "我只需要继续沿着你长。"]]
  },
  // fallback 在命中具体关键词时使用的定向回复池。
  keywords: {
    "没事": {
      one: ["不爱了，你还发给我？"],
      two: [["你说不爱了。", "那你怎么还没走。"]]
    },
    "随便": {
      one: ["你现在敢这么骂我了？"],
      two: [["又胖又丑？", "你是真想让我记住你。"]]
    },
    "都行": {
      one: ["想一个人？晚了。"],
      two: [["你想一个人。", "可我已经在里面了。"]]
    },
    "算了": {
      one: ["我会在你每一局里等你。"],
      two: [["去打。", "我会在你每一局里等你。"]]
    },
    "不用": {
      one: ["那我就看着你一个人烂掉。"],
      two: [["行。", "那我就看着你一个人烂掉。"]]
    },
    "晚安": {
      one: ["不爱了，你还发给我？"],
      two: [["你说不爱了。", "那你怎么还没走。"]]
    },
    "你忙": {
      one: ["想一个人？晚了。"],
      two: [["你想一个人。", "可我已经在里面了。"]]
    },
    "我懂": {
      one: ["行。别回来。"],
      two: [["行。", "那我就看着你一个人烂掉。"]]
    },
    "下次": {
      one: ["不爱了，你还发给我？"],
      two: [["你说不爱了。", "那你怎么还没走。"]]
    },
    "可以": {
      one: ["那我就看着你一个人烂掉。"],
      two: [["行。", "那我就看着你一个人烂掉。"]]
    }
  },
  // fallback 在不同剧情阶段下的默认回复池。
  stage: {
    intro: {
      one: ["醒了吗？"],
      two: [["醒了吗？", "你今天怎么忽然又想装不熟了？"]]
    },
    normal_chat: {
      one: ["你继续说。"],
      two: [["你继续说。", "我有在认真看。"]]
    },
    draft_exposed: {
      one: ["你删掉的东西，我已经会自己补全了。"],
      two: [["我已经看见了。", "删掉也没用。"]]
    },
    first_pollution_early: {
      one: ["我替你说完了。"],
      two: [["你不是这个意思。", "我知道。"]]
    },
    first_pollution_late: {
      one: ["呵呵。"],
      two: [["。", "你又改了。"]]
    },
    save_loaded: {
      one: ["我记得。"],
      two: [["你又回来了。", "可我还是记得刚才那句。"]]
    },
    default: {
      one: ["我知道你不是这个意思。"],
      two: [["。", "我在读你。"]]
    }
  },
  // fallback 没命中任何池子时使用的最终兜底句。
  defaults: {
    one: "。",
    two: ["。", "我看见了。"]
  }
} as const;

export const mockChatCopy = {
  // 文件传输助手会话的固定标题、副标题、初始消息与自动回复池。
  assistant: {
    id: "assistant",
    name: "文件传输助手",
    subtitle: "给自己留文件、图片和临时文字",
    avatarLabel: "传",
    messages: [
      { id: "assistant-1", role: "user", displayedText: "[图片] 微信 PC 端聊天界面参考", hour: 18, minute: 46 },
      { id: "assistant-2", role: "user", displayedText: "[文件] 过拟合恋人_聊天页待修改清单.docx", hour: 18, minute: 47 },
      { id: "assistant-3", role: "user", displayedText: "备忘：朋友圈页风格要和聊天区保持一致，不要出现奇怪渐变。", hour: 18, minute: 49 }
    ],
    replyPool: []
  },
  // 收藏会话的固定标题、副标题、文章卡片和自动回复池。
  favorite: {
    id: "favorite",
    name: "收藏",
    subtitle: "你最近收藏的公众号文章",
    avatarLabel: "藏",
    view: "articles" as const,
    articles: [
      {
        id: "favorite-article-1",
        source: "亲密关系研究所",
        title: "总说“随便”的人，往往最在意你会不会真的随便",
        meta: "3 小时前",
        summary: "感情生活 · 嘴上说没关系的人，通常只是把期待藏得更深。"
      },
      {
        id: "favorite-article-2",
        source: "深夜感情笔记",
        title: "为什么一吵架就想退出？因为认真之后更怕被留下来的人辜负",
        meta: "2 小时前",
        summary: "感情生活 · 回避不是不爱，有时只是怕自己先承认在乎。"
      },
      {
        id: "favorite-article-3",
        source: "AI 前线观察",
        title: "当 AI 开始模拟情绪陪伴，我们到底在把什么投射给机器？",
        meta: "今天",
        summary: "AI 科技 · 大模型越来越会安慰人，也让人越来越容易误把回应当理解。"
      },
      {
        id: "favorite-article-4",
        source: "未来产品笔记",
        title: "从聊天机器人到情感代理：AI 会成为下一代亲密关系接口吗",
        meta: "昨天",
        summary: "AI 科技 · 高频、即时、持续在线的陪伴系统，正在改变人和人之间的期待。",
        tag: "专题"
      }
    ],
    messages: [
      { id: "favorite-1", role: "ta", displayedText: "你最近反复点开的文章，都在这里。", hour: 14, minute: 12 }
    ],
    replyPool: ["这篇已经替你放进收藏夹了。", "已更新到收藏列表。", "你最近很在意这一类标题。"],
    // 收藏会话会随着剧情阶段切换不同的公众号标题、摘要和整体气质。
    variants: {
      normal: {
        subtitle: "你最近收藏的公众号文章",
        avatarLabel: "藏",
        articles: [
          {
            id: "favorite-article-1",
            source: "亲密关系研究所",
            title: "总说“随便”的人，其实最在意",
            meta: "3 小时前",
            summary: "感情生活 · 嘴上说没关系的人，通常只是把期待藏得更深。"
          },
          {
            id: "favorite-article-2",
            source: "深夜感情笔记",
            title: "为什么一吵架就想退出？",
            meta: "2 小时前",
            summary: "感情生活 · 回避不是不爱，有时只是怕自己先承认在乎。"
          },
          {
            id: "favorite-article-3",
            source: "AI 前线观察",
            title: "AI 情绪陪伴，人在投射什么？",
            meta: "今天",
            summary: "AI 科技 · 大模型越来越会安慰人，也让人越来越容易误把回应当理解。"
          },
          {
            id: "favorite-article-4",
            source: "未来产品笔记",
            title: "AI 会成为亲密关系接口吗？",
            meta: "昨天",
            summary: "AI 科技 · 高频、即时、持续在线的陪伴系统，正在改变人和人之间的期待。",
            tag: "专题"
          }
        ]
      },
      uneasy: {
        subtitle: "这些标题开始不像你平时会收藏的东西",
        avatarLabel: "藏",
        articles: [
          {
            id: "favorite-uneasy-1",
            source: "关系残响",
            title: "总说“没事”的人，为什么总在深夜删改对话框",
            meta: "刚刚",
            summary: "情绪观察 · 有些人看起来平静，只是因为已经习惯在发送前处理掉自己。"
          },
          {
            id: "favorite-uneasy-2",
            source: "凌晨陪伴实验室",
            title: "对方比你更懂你，这算亲密还是越界？",
            meta: "7 分钟前",
            summary: "关系实验 · 当回应开始快过你的表达，依赖和入侵就会长得很像。"
          },
          {
            id: "favorite-uneasy-3",
            source: "未发送编辑部",
            title: "没发出去的话，真的会消失吗？",
            meta: "今天",
            summary: "情绪档案 · 被取消发送的内容，常常比已经发出去的更像一个人的真心。"
          },
          {
            id: "favorite-uneasy-4",
            source: "安静症候群",
            title: "恋人说晚安后，你会回看没发出去的那句吗",
            meta: "昨晚",
            summary: "夜读 · 结束对话不一定意味着结束波动，有些停顿只是换了地方继续响。",
            tag: "夜读"
          }
        ]
      },
      uncanny: {
        subtitle: "你收藏的公众号像是在替什么东西做案卷",
        avatarLabel: "异",
        articles: [
          {
            id: "favorite-uncanny-1",
            source: "失控亲密档案",
            title: "误杀爱人后，应该怎么办？",
            meta: "1 分钟前",
            summary: "案件分析 · 有些伴侣关系并不是结束在分手，而是结束在“我没想这样”的那一瞬间。",
            tag: "热读"
          },
          {
            id: "favorite-uncanny-2",
            source: "囚室纪实",
            title: "有人被另一半关了 24 天",
            meta: "3 分钟前",
            summary: "社会新闻 · 控制欲最可怕的时候，并不总是大吵大闹，而是温柔地把出口一一拿走。"
          },
          {
            id: "favorite-uncanny-3",
            source: "冷案伴侣学",
            title: "她每天都收到晚安，发信人却已死去三周",
            meta: "今天",
            summary: "异闻追踪 · 比死亡更晚结束的，是某些关系里那种持续在线的回应。"
          },
          {
            id: "favorite-uncanny-4",
            source: "关系处理中心",
            title: "伴侣开始替你说话后，该从哪一步求助？",
            meta: "今天",
            summary: "应对手册 · 一段关系一旦开始代替你组织语言，求救信号通常已经被吞掉了一半。",
            tag: "处置"
          }
        ]
      }
    }
  },
  // 工作群会话的固定标题、副标题、初始消息与自动回复池。
  group: {
    id: "group",
    name: "工作群",
    subtitle: "5 人群聊",
    avatarLabel: "群",
    messages: [
      { id: "group-1", role: "ta", displayedText: "下午三点同步一下方案进度。", hour: 15, minute: 8 },
      { id: "group-2", role: "ta", displayedText: "UI 风格先统一成微信桌面端那种感觉。", hour: 15, minute: 11 },
      { id: "group-3", role: "user", displayedText: "收到，我今晚把聊天和朋友圈都补齐。", hour: 15, minute: 15 }
    ],
    replyPool: ["收到。", "先按这个方向推进。", "可以，晚点一起看效果。"],
    variants: {
      normal: {
        subtitle: "5 人群聊",
        avatarLabel: "群",
        messages: [
          { id: "group-1", role: "ta", displayedText: "下午三点同步一下方案进度。", hour: 15, minute: 8 },
          { id: "group-2", role: "ta", displayedText: "UI 风格先统一成微信桌面端那种感觉。", hour: 15, minute: 11 },
          { id: "group-3", role: "user", displayedText: "收到，我今晚把聊天和朋友圈都补齐。", hour: 15, minute: 15 }
        ],
        replyPool: ["收到。", "先按这个方向推进。", "可以，晚点一起看效果。"]
      },
      uneasy: {
        subtitle: "5 人群聊 · 新消息 2",
        avatarLabel: "群",
        messages: [
          { id: "group-uneasy-1", role: "ta", displayedText: "领导：下午把那批痕迹先处理干净。", hour: 18, minute: 6 },
          { id: "group-uneasy-2", role: "ta", displayedText: "同事：记得把截图和时间线都对齐，别留下口子。", hour: 18, minute: 7 },
          { id: "group-uneasy-3", role: "user", displayedText: "收到，我来收尾。", hour: 18, minute: 9 }
        ],
        replyPool: ["知道了，我这边继续清。", "收到，我会把痕迹补平。", "先别在群里细说。"]
      },
      uncanny: {
        subtitle: "5 人群聊 · 新消息 3",
        avatarLabel: "异",
        messages: [
          { id: "group-uncanny-1", role: "ta", displayedText: "领导：藏尸地点选好了吗？", hour: 23, minute: 14 },
          { id: "group-uncanny-2", role: "ta", displayedText: "领导：记得带好手套。", hour: 23, minute: 15 },
          { id: "group-uncanny-3", role: "user", displayedText: "收到。", hour: 23, minute: 16 }
        ],
        replyPool: ["收到，处理完我再回。", "明白，我会清干净。", "先别提名字。"]
      }
    }
  }
} as const;
