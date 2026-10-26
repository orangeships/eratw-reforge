import type { CharacterDialoguePack } from "../native-dialogue.js";
import type { SunnyNativeDialogueAssets } from "./sunny-assets.js";
import { resolveSunnyAsset, resolveSunnyAssetInteractive, sunnyAssetClaims } from "./sunny-assets.js";

function pick<T>(values: readonly T[], index: number): T {
  return values[index % values.length]!;
}

function lines(
  form: "PRINTFORML" | "PRINTFORMW" | "PRINTFORMDL" | "PRINTFORMDW",
  line: number,
  text: string,
) {
  return { form, line, text } as const;
}

/** First native K5 slice. The base first-meeting narration comes from
 * M_KOJO_ENCOUNTER_K5; companion-specific lines remain in the compatibility
 * oracle until the presence-aware Sunny pack is complete. */
export const SUNNY_NATIVE_DIALOGUE_PACK: CharacterDialoguePack = {
  charaNum: 5,
  variantId: "0",
  claims: (trigger) => trigger.kind === "character.firstMet" ||
    (trigger.kind === "command.completed" &&
      (trigger.commandNo === 300 || trigger.commandNo === 301 || trigger.commandNo === 302 ||
        trigger.commandNo === 303 || trigger.commandNo === 305 || trigger.commandNo === 306 || trigger.commandNo === 307 ||
        trigger.commandNo === 308 || trigger.commandNo === 309 || trigger.commandNo === 331 || trigger.commandNo === 332 || trigger.commandNo === 334 || trigger.commandNo === 335 ||
        trigger.commandNo === 336)),
  rules: [
    {
      id: "sunny.first-met.welcome-outside-worlder",
      on: "character.firstMet",
      priority: 100,
      when: () => true,
      lines: () => [
        { form: "PRINTFORML", line: 141, text: "「啊、你醒了呢！」" },
        { form: "PRINTFORMDL", line: 150, text: "你面前有一个似乎很亲近人的少女靠了过来。" },
        { form: "PRINTFORMDL", line: 151, text: "你看见了一个金发中长发配上双马尾、带着开朗表情、每次说话都会露出小虎牙的可爱少女。" },
        { form: "PRINTFORML", line: 155, text: "「好像已经睡了很久呢。感觉是对时间的感觉错乱了哇」" },
        { form: "PRINTFORMW", line: 156, text: "「你、睡在了我们家的门口呢。放着不管的话你可能就在妖怪的肚子里睡觉了呢」" },
        { form: "PRINTFORML", line: 185, text: "「但是交给我吧！你就住在我们三妖精的家里吧！」" },
        { form: "PRINTFORMW", line: 187, text: "「作为交换、来告诉我外面文明的事情吧！这是个不错的提案对吧？呐！」" },
        { form: "PRINTFORML", line: 206, text: "「我是桑尼米尔克！」" },
        { form: "PRINTFORMW", line: 220, text: "「那么接下来请多指教！」" },
      ],
    },
    {
      id: "sunny.talk.time-stopped",
      on: "command.completed",
      priority: 100,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 300 && context.timeStopped,
      lines: () => [],
    },
    {
      id: "sunny.talk.angry",
      on: "command.completed",
      priority: 90,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 300 && context.relationship.angry,
      lines: () => [lines("PRINTFORMW", 29, "「这个故事已经听腻了ー！」")],
    },
    {
      id: "sunny.talk.strongly-pent-up",
      on: "command.completed",
      priority: 80,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 300 && context.sexual.isStronglyPentUp,
      lines: (context, rng) => pick([
        [
          lines("PRINTFORML", 37, "「唔…唔嗯、没什么事…」"),
          lines("PRINTFORMDW", 38, `桑尼露出很难受的表情凝视着${context.masterName}的股间。`),
        ],
        [
          lines("PRINTFORML", 40, "「今天不做吗？」"),
          lines("PRINTFORMDW", 41, "桑尼扭扭捏捏地摩擦着双腿。"),
        ],
        [
          lines("PRINTFORML", 43, "「……诶？啊咧、你刚才说了什么…？」"),
          lines("PRINTFORMDW", 44, `面色潮红的桑尼看着${context.masterName}。`),
        ],
      ], rng.int(3)),
    },
    {
      id: "sunny.talk.love",
      on: "command.completed",
      priority: 70,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 300 &&
        (context.relationshipStage === "love" || context.relationshipStage === "lover"),
      lines: (context, rng) => pick([
        [
          lines("PRINTFORML", 49, "「然后呢！然后呢！」"),
          lines("PRINTFORMDW", 50, "桑尼摇晃着身体开心地和你说着话。"),
        ],
        [
          lines("PRINTFORML", 52, `「${context.masterName}喜欢我的哪里呢？」`),
          lines("PRINTFORML", 53, `「阳光般的笑容？在${context.masterName}面前不由自主就露出了笑容呢！只要你喜欢要多少有多少！」`),
          lines("PRINTFORMDW", 54, "桑尼捧着她柔软的脸颊抬头看着你。"),
        ],
        [
          lines("PRINTFORML", 56, "「这个智能手机有抽卡？在里面吗。这个好像能够吸取金钱啊！」"),
          lines("PRINTFORMW", 57, "「但是不管是摩擦它还是放置都毫无反应…是假的吗？」"),
        ],
        [
          lines("PRINTFORML", 59, "「露娜最近在栽培栗子呢」"),
          lines("PRINTFORMW", 60, "「斯塔也种了蘑菇的盆栽、我也来种点什么吧」"),
        ],
        [
          lines("PRINTFORML", 62, "「你去过地狱了吗？那里是个很可怕的地方！」"),
          lines("PRINTFORMW", 63, "「温泉…？鬼…？那是什么？」"),
        ],
      ], rng.int(5)),
    },
    {
      id: "sunny.talk.affection",
      on: "command.completed",
      priority: 60,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 300 && context.relationshipStage === "affection",
      lines: (context, rng) => pick([
        [lines("PRINTFORMW", 69, "「内衣雨的话就算隐身了也会被找到。为什么呢？」")],
        [lines("PRINTFORMW", 71, `「有${context.masterName}的话平时总是进不去的地方就可以堂堂正正地进去了，所以喜欢！」`)],
        [
          lines("PRINTFORMW", 73, "「恶作剧正是妖精的本分、使命、生存的粮食！」"),
          lines("PRINTFORMW", 74, `「${context.masterName}的话应该明白的吧？」`),
        ],
      ], rng.int(3)),
    },
    {
      id: "sunny.talk.ordinary",
      on: "command.completed",
      priority: 10,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 300,
      lines: (context, rng) => pick([
        [
          lines("PRINTFORMW", 80, "「灵梦桑最近好久没有被作为恶作剧的目标了哟」"),
          lines("PRINTFORMW", 81, `「${context.masterName}有什么好主意吗？」`),
        ],
        [
          lines("PRINTFORMW", 83, "「最近钓妖精在流行着真是岂有此理、但是我可不是那么轻易就上钩的！」"),
          lines("PRINTFORMW", 84, "「唉？如果有点心掉在地上怎么办？肯定是马上跳到那里去拿啊！」"),
        ],
        [
          lines("PRINTFORMW", 86, "「我是阳光妖精所以太阳出来我就精神满满！」"),
          lines("PRINTFORMW", 87, "「但是没太阳就会筋疲力尽了……无论是体力上还是精神上…」"),
        ],
      ], rng.int(3)),
    },
    {
      id: "sunny.touch.time-stopped-or-angry",
      on: "command.completed",
      priority: 100,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 302 && (context.timeStopped || context.relationship.angry),
      lines: () => [],
    },
    {
      id: "sunny.touch.strongly-pent-up",
      on: "command.completed",
      priority: 80,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 302 && context.sexual.isStronglyPentUp,
      lines: (context, rng) => {
        const choice = rng.int(4);
        if (choice === 1) {
          return [
            lines("PRINTFORMDL", 180, `${context.masterName}用膝盖不停地蹭着坐在你大腿上的桑尼的私处。`),
            lines("PRINTFORML", 181, "「呀…不可以那样的蹭着啊…♥」"),
            lines("PRINTFORMDW", 182, `桑尼带着湿润地眼眸想要离开${context.masterName}的膝盖、但是她的力量弱弱的。`),
          ];
        }
        if (choice === 0) {
          return [
            lines("PRINTFORML", 184, "「摩擦这里的感觉好舒服哦。嗯…♥」"),
            lines("PRINTFORMDL", 185, `桑尼毫不在意别人的目光、拿起${context.masterName}的手隔着胖次摩擦自己的秘缝。`),
            lines("PRINTFORMDW", 186, `${context.masterName}慌忙地阻止了桑尼的痴态。`),
          ];
        }
        return [
          lines("PRINTFORML", 188, "「嗯…多摸一摸…♥」"),
          lines("PRINTFORMDW", 189, `桑尼带着很热似的表情将头埋进了${context.masterName}的胸前。`),
        ];
      },
    },
    {
      id: "sunny.touch.love",
      on: "command.completed",
      priority: 70,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 302 &&
        (context.relationshipStage === "love" || context.relationshipStage === "lover"),
      lines: (context, rng) => pick([
        [
          lines("PRINTFORMDL", 202, "抱着桑尼尽情的抚摸。"),
          lines("PRINTFORMDL", 203, `被抚摸着的桑尼抱着${context.masterName}的一只手臂。`),
          lines("PRINTFORMW", 204, "「这样子做的话、总感觉会很安心呢！」"),
        ],
        [
          lines("PRINTFORMDL", 198, `${context.masterName}抚摸着桑尼纤细白皙的腿。`),
          lines("PRINTFORMDL", 199, `桑尼的肩膀微微的颤抖着、假装出一副愤怒的表情瞪着${context.masterName}。`),
          lines("PRINTFORMW", 200, "「呀呜！…真是的、虽然很开心但是突然触摸的话我会被吓到的！」"),
        ],
        [
          lines("PRINTFORMDL", 194, `桑尼抱着${context.masterName}的脖子摇摇晃晃地摆动着腿。`),
          lines("PRINTFORMW", 195, "「不是背后灵、是背后妖精哒！」"),
        ],
        [
          lines("PRINTFORML", 206, "「你能抓到隐身了的我嘛？」"),
          lines("PRINTFORMDL", 207, `${context.masterName}抱住了这个看起来就不太自然的空间、很容易就找到了看不见的桑尼。`),
          lines("PRINTFORMW", 208, `「正确答案！不愧是${context.masterName}呢」`),
        ],
      ], rng.int(4)),
    },
    {
      id: "sunny.touch.affection",
      on: "command.completed",
      priority: 60,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 302 && context.relationshipStage === "affection",
      lines: (_context, rng) => pick([
        [
          lines("PRINTFORML", 216, "「啊哈哈哈哈、呀哈哈！！」"),
          lines("PRINTFORMW", 217, "「哇、不可以揉翅膀！会很痒哈哈哈！！」"),
        ],
        [
          lines("PRINTFORMDL", 213, "抓着桑尼的双手像链球一样旋转着。"),
          lines("PRINTFORMW", 214, "「呜哇啊！！眼、眼前在旋转着！！」"),
        ],
        [
          lines("PRINTFORMDL", 219, "骑在肩膀上的桑尼模仿起了歌利娅人偶。"),
          lines("PRINTFORMW", 220, "「啊哈哈哈！就这样冲啊ー！」"),
        ],
      ], rng.int(3)),
    },
    {
      id: "sunny.touch.ordinary",
      on: "command.completed",
      priority: 10,
      when: (context) => context.trigger.kind === "command.completed" && context.trigger.commandNo === 302,
      lines: (_context, rng) => pick([
        [
          lines("PRINTFORMDL", 233, "和桑尼一起玩猜硬币游戏。"),
          lines("PRINTFORML", 234, "「硬币在哪只手里？简单呐、在这边！」"),
          lines("PRINTFORMW", 235, "「啊咧、搞错了…」"),
        ],
        [
          lines("PRINTFORMDL", 225, "你尝试着抚摸桑尼的时候、桑尼轻飘飘的身体轻巧地躲开了。"),
          lines("PRINTFORML", 226, "「傻傻的、想抓住我？」"),
          lines("PRINTFORMW", 227, "「不要以为妖精能那么简单地抓住哟ー！」"),
        ],
        [
          lines("PRINTFORML", 237, "「如何？我现在就在你面前、你完全看不到吧？」"),
          lines("PRINTFORMW", 238, "「咿呀！你在摸哪里啊！？」"),
        ],
      ], rng.int(3)),
    },
    {
      id: "sunny.lap-pillow.time-stopped-or-angry",
      on: "command.completed",
      priority: 100,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 305 && (context.timeStopped || context.relationship.angry),
      lines: () => [],
    },
    {
      id: "sunny.lap-pillow.late-pregnancy",
      on: "command.completed",
      priority: 80,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 305 && context.pregnancy.isAwareLatePregnancy &&
        (context.relationshipStage === "love" || context.relationshipStage === "lover"),
      lines: (context, rng) => pick([
        [
          lines("PRINTFORML", 402, "「快看ー是爸爸哟～」"),
          lines("PRINTFORMDW", 403, `${context.masterName}枕在桑尼的膝盖上、耳朵贴着她的肚子上。`),
        ],
        [
          lines("PRINTFORML", 399, "「该给这个孩子取什么名字好呢～♪」"),
          lines("PRINTFORMDW", 400, "你一边仰望着桑尼开心的脸一边享受着柔软的膝盖触感。"),
        ],
        [
          lines("PRINTFORMDL", 405, `${context.masterName}将耳朵贴到桑尼隆起的肚子上、肚子稍微的动了一下。`),
          lines("PRINTFORMW", 406, `「肚子里的孩子也知道${context.masterName}是爸爸呢！」`),
        ],
      ], rng.int(3)),
    },
    {
      id: "sunny.lap-pillow.love",
      on: "command.completed",
      priority: 70,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 305 &&
        (context.relationshipStage === "love" || context.relationshipStage === "lover"),
      lines: (context, rng) => pick([
        [
          lines("PRINTFORML", 414, "「这个样子总感觉…像夫妇一样呢！」"),
          lines("PRINTFORMW", 415, "「……说、说点什么呀」"),
        ],
        [
          lines("PRINTFORMDL", 411, "侧耳倾听桑尼的肚子感受着和温暖一起微微的心跳声。"),
          lines("PRINTFORMW", 412, "「我就像太阳一样暖和对吧ー？」"),
        ],
        [
          lines("PRINTFORML", 417, "「我随时都可以借膝盖给你哇！」"),
          lines("PRINTFORMW", 418, `「因为能在很近的距离看着${context.masterName}呢！」`),
        ],
      ], rng.int(3)),
    },
    {
      id: "sunny.lap-pillow.affection",
      on: "command.completed",
      priority: 60,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 305 && context.relationshipStage === "affection",
      lines: (context, rng) => pick([
        [
          lines("PRINTFORML", 427, `「${context.masterName}ー嗨呀ー嗯」`),
          lines("PRINTFORMDW", 428, `桑尼毫不客气地拉着拧着${context.masterName}的耳朵。`),
        ],
        [
          lines("PRINTFORML", 423, "「会让你暖和起来的！」"),
          lines("PRINTFORMDW", 424, `桑尼像是要覆盖住${context.masterName}似的抱住了你的头。`),
          lines("PRINTFORMDL", 425, `${context.masterName}感受着牛奶的香甜气息。`),
        ],
        [
          lines("PRINTFORML", 430, "「看招看招ー」"),
          lines("PRINTFORMDW", 431, `桑尼揉着${context.masterName}的脸蛋。`),
        ],
      ], rng.int(3)),
    },
    {
      id: "sunny.lap-pillow.ordinary",
      on: "command.completed",
      priority: 10,
      when: (context) => context.trigger.kind === "command.completed" && context.trigger.commandNo === 305,
      lines: (context, rng) => pick([
        [
          lines("PRINTFORML", 439, "「发现分叉的头发！」"),
          lines("PRINTFORMDW", 440, `桑尼毫不留情地拔掉了${context.masterName}的头发。`),
        ],
        [
          lines("PRINTFORML", 436, "「给你做膝枕…突然地来个膝踢！」"),
          lines("PRINTFORMDW", 437, `桑尼毫不留情的膝踢让${context.masterName}的侧头部摇晃了起来。`),
        ],
        [lines("PRINTFORMW", 442, "「好ー重ー啊ー！」")],
      ], rng.int(3)),
    },
    {
      id: "sunny.belly-rub.time-stopped-or-angry",
      on: "command.completed",
      priority: 100,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 306 && (context.timeStopped || context.relationship.angry),
      lines: () => [],
    },
    {
      id: "sunny.belly-rub.late-pregnancy",
      on: "command.completed",
      priority: 80,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 306 && context.pregnancy.isAwareLatePregnancy &&
        (context.relationshipStage === "love" || context.relationshipStage === "lover"),
      lines: (context, rng) => pick([
        [
          lines("PRINTFORML", 470, "「肚子里的孩子知道是爸爸在触摸她妈？」"),
          lines("PRINTFORMDW", 471, `${context.masterName}和桑尼一起温柔的抚摸着膨胀起来的肚子。`),
        ],
        [
          lines("PRINTFORML", 467, "「没想到会长这么大连我都吓了一跳呢」」"),
          lines("PRINTFORMDW", 468, `${context.masterName}像是在担心桑尼的身体一样地抚摸着和妖精小小的身体完全不协调的大肚子。`),
        ],
        [
          lines("PRINTFORMDL", 473, `${context.masterName}将手放在桑尼膨胀的肚子上的时候、肚子突然动了一下。`),
          lines("PRINTFORMW", 474, `「好想要早点见到你呢！我和${context.masterName}的小宝宝！」`),
        ],
      ], rng.int(3)),
    },
    {
      id: "sunny.belly-rub.love",
      on: "command.completed",
      priority: 70,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 306 &&
        (context.relationshipStage === "love" || context.relationshipStage === "lover"),
      lines: (context, rng) => pick([
        [
          lines("PRINTFORMDL", 482, "装作抚摸桑尼肚子趁机捏了一下。"),
          lines("PRINTFORMDL", 483, "享受了一下柔软的触感……然而、被桑尼掐了一下手背。"),
          lines("PRINTFORMW", 484, "「………到底想做什么呢ー？」"),
        ],
        [
          lines("PRINTFORML", 479, "「呼嘿嘿ー总觉得很幸福ー」"),
          lines("PRINTFORMDW", 480, `桑尼把边双手重叠在${context.masterName}手上笑着`),
        ],
        [
          lines("PRINTFORML", 486, "「这么想要抚摸的话那就没办法了呢！」"),
          lines("PRINTFORMW", 487, "「撒、尽情的享受吧！」"),
        ],
      ], rng.int(3)),
    },
    {
      id: "sunny.belly-rub.affection",
      on: "command.completed",
      priority: 60,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 306 && context.relationshipStage === "affection",
      lines: (context, rng) => pick([
        [
          lines("PRINTFORML", 495, "「怎么了、那样的抚摸我…难道说」"),
          lines("PRINTFORMW", 496, "「我长胖了！？」"),
        ],
        [
          lines("PRINTFORML", 492, `「${context.masterName}的手很暖和啊」`),
          lines("PRINTFORMW", 493, "「再稍微摸一下！拜托了！」"),
        ],
        [lines("PRINTFORMW", 498, "「噗噗…想吃荞麦面了」")],
      ], rng.int(3)),
    },
    {
      id: "sunny.belly-rub.ordinary",
      on: "command.completed",
      priority: 10,
      when: (context) => context.trigger.kind === "command.completed" && context.trigger.commandNo === 306,
      lines: (context, rng) => pick([
        [
          lines("PRINTFORML", 506, "「嗯ー…这样的抚摸不太舒服啊！」"),
          lines("PRINTFORMDW", 507, `桑尼扭动着身体从${context.masterName}的手里逃了出来。`),
        ],
        [
          lines("PRINTFORML", 503, `「呜呀！${context.masterName}的手太冷了！」`),
          lines("PRINTFORMDW", 504, `桑尼被吓了一跳拍掉了${context.masterName}的手。`),
        ],
        [lines("PRINTFORMW", 509, "「突然摸我的肚子、打算干什么呢？」")],
      ], rng.int(3)),
    },
    {
      id: "sunny.cheek-pinch.time-stopped",
      on: "command.completed",
      priority: 100,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 307 && context.timeStopped,
      lines: () => [],
    },
    {
      id: "sunny.cheek-pinch.angry",
      on: "command.completed",
      priority: 90,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 307 && context.relationship.angry,
      lines: () => [
        lines("PRINTFORML", 539, "「嘶ー嗯…」"),
        lines("PRINTFORMDW", 540, "桑尼为了不被捏把脸颊裹鼓了起来。"),
      ],
    },
    {
      id: "sunny.cheek-pinch.sleeping",
      on: "command.completed",
      priority: 80,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 307 && context.status.isSleeping,
      lines: () => [lines("PRINTFORMW", 542, "「嗯～再睡5分钟～」")],
    },
    {
      id: "sunny.cheek-pinch.love",
      on: "command.completed",
      priority: 70,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 307 &&
        (context.relationshipStage === "love" || context.relationshipStage === "lover"),
      lines: (context, rng) => pick([
        [
          lines("PRINTFORML", 549, "「妖精的脸颊很软对吧！」"),
          lines("PRINTFORMW", 550, `「如果满足了的话让我也来捏捏${context.masterName}的脸吧！」`),
        ],
        [
          lines("PRINTFORML", 546, "「呼呼呼ー这是回礼哟！」"),
          lines("PRINTFORMW", 547, `「看招看招…啊咧、${context.masterName}胖了吗？」`),
        ],
        [
          lines("PRINTFORML", 552, "「呼呼呼ー这是回礼哟！」"),
          lines("PRINTFORMW", 553, "「看招看招看招看招！」"),
        ],
      ], rng.int(3)),
    },
    {
      id: "sunny.cheek-pinch.affection",
      on: "command.completed",
      priority: 60,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 307 && context.relationshipStage === "affection",
      lines: (_context, rng) => pick([
        [
          lines("PRINTFORML", 561, "「姆尼ー」"),
          lines("PRINTFORMDW", 562, "用不会让桑尼感到疼的力度玩弄着桑尼的脸颊。"),
          lines("PRINTFORML", 563, "「接着就是我的回合了呢！」"),
        ],
        [
          lines("PRINTFORMDL", 558, "从桑尼的脸颊那里传来了香甜的气味"),
          lines("PRINTFORMW", 559, "「…是因为刚才吃了牡丹饼吗？」"),
        ],
        [
          lines("PRINTFORML", 565, "「拧的话就是要这样做哟！」"),
          lines("PRINTFORMDW", 566, "被桑尼狠狠地拧了下脸。"),
        ],
      ], rng.int(3)),
    },
    {
      id: "sunny.cheek-pinch.ordinary",
      on: "command.completed",
      priority: 10,
      when: (context) => context.trigger.kind === "command.completed" && context.trigger.commandNo === 307,
      lines: (context, rng) => pick([
        [
          lines("PRINTFORML", 574, "「姆ー、真是碍事ー！」"),
          lines("PRINTFORMDW", 575, `桑尼很烦躁的拿开了${context.masterName}的手。`),
        ],
        [
          lines("PRINTFORML", 571, "「既然做了的话就要3倍的回击呢！」"),
          lines("PRINTFORMDW", 572, "脸被桑尼掐红了…。"),
        ],
        [
          lines("PRINTFORML", 577, "「哟嚯！搞冻！」"),
          lines("PRINTFORMW", 578, "「太用力了啊！」"),
        ],
      ], rng.int(3)),
    },
    {
      id: "sunny.cheek-poke.sleeping",
      on: "command.completed",
      priority: 100,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 308 && context.status.isSleeping,
      lines: (_context, rng) => pick([
        [
          lines("PRINTFORML", 610, "「什么啊…还没上年纪就起不来了啊ー…」"),
          lines("PRINTFORMW", 611, "「呼ー…呼ー…」"),
        ],
        [
          lines("PRINTFORML", 607, "「嗯真是的ー露娜你竟然做这样的事情ー」"),
          lines("PRINTFORMW", 608, "「那里很敏感的…呼…」"),
        ],
        [
          lines("PRINTFORML", 613, "「已经吃不下了哟ー」"),
          lines("PRINTFORMW", 614, "「姆喵姆喵…」"),
        ],
      ], rng.int(3)),
    },
    {
      id: "sunny.apology.accepted.love",
      on: "command.completed",
      priority: 70,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 303 && context.command.isAccepted &&
        (context.relationshipStage === "love" || context.relationshipStage === "lover"),
      lines: (context) => [
        lines("PRINTFORML", 265, "「…让我看看你的诚意！」"),
        lines("PRINTFORMDL", 266, "桑尼脑袋转向了这边、嘴巴变成了へ字。"),
        lines("PRINTFORMDL", 267, `${context.masterName}抱住了桑尼、温柔的抚摸着她金色的头发，桑尼的表情缓和了下来。`),
        lines("PRINTFORMW", 268, "「唔嗯唔嗯、惩罚一下好了下次可不要这样了！」"),
      ],
    },
    {
      id: "sunny.apology.accepted.affection",
      on: "command.completed",
      priority: 60,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 303 && context.command.isAccepted &&
        context.relationshipStage === "affection",
      lines: (context) => [
        lines("PRINTFORML", 270, "「我是不会原谅你的…！」"),
        lines("PRINTFORMDL", 271, `作为道歉、${context.masterName}拿出了菓子屋买的团子。`),
        lines("PRINTFORMW", 272, "「啊呜啊呜…这可不是一般程度的美味呢…原谅你了！」"),
      ],
    },
    {
      id: "sunny.apology.accepted.ordinary",
      on: "command.completed",
      priority: 10,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 303 && context.command.isAccepted,
      lines: () => [
        lines("PRINTFORML", 274, "「这次就原谅你了…」"),
        lines("PRINTFORMW", 275, "「不可以在做这种事了哟」"),
      ],
    },
    {
      id: "sunny.apology.rejected.love",
      on: "command.completed",
      priority: 70,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 303 && !context.command.isAccepted &&
        (context.relationshipStage === "love" || context.relationshipStage === "lover"),
      lines: () => [
        lines("PRINTFORML", 279, "「…………………哼」"),
        lines("PRINTFORMDW", 280, "桑尼变得透明把脸扭过去了。"),
      ],
    },
    {
      id: "sunny.apology.rejected.affection",
      on: "command.completed",
      priority: 60,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 303 && !context.command.isAccepted &&
        context.relationshipStage === "affection",
      lines: (context) => [
        lines("PRINTFORML", 282, "「我现在还很生气…」"),
        lines("PRINTFORMDL", 283, `桑尼鼓起脸颊瞪着${context.masterName}。`),
        lines("PRINTFORMW", 284, "「如果不好好道歉的话是不会原谅你的」"),
      ],
    },
    {
      id: "sunny.apology.rejected.ordinary",
      on: "command.completed",
      priority: 10,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 303 && !context.command.isAccepted,
      lines: () => [
        lines("PRINTFORML", 286, "「什么啊ー！要打架吗ー！」"),
        lines("PRINTFORMDW", 287, "…桑尼挽起袖子眼看就要打过来了。"),
      ],
    },
    {
      id: "sunny.head-pat.time-stopped",
      on: "command.completed",
      priority: 100,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 309 && context.timeStopped,
      lines: () => [],
    },
    {
      id: "sunny.head-pat.angry",
      on: "command.completed",
      priority: 90,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 309 && context.relationship.angry,
      lines: () => [lines("PRINTFORMW", 644, "「我可不会轻易被这样的给敷衍过去的」！")],
    },
    {
      id: "sunny.head-pat.sleeping",
      on: "command.completed",
      priority: 80,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 309 && context.status.isSleeping,
      lines: () => [lines("PRINTFORMW", 646, "「姆喵姆喵…欸嘿嘿…」")],
    },
    {
      id: "sunny.head-pat.love",
      on: "command.completed",
      priority: 70,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 309 &&
        (context.relationshipStage === "love" || context.relationshipStage === "lover"),
      lines: (context, rng) => pick([
        [
          lines("PRINTFORMDL", 653, `${context.masterName}十分享受的抚摸着桑尼的双马尾。`),
          lines("PRINTFORMW", 654, `「能够这样子触摸的只有${context.masterName}一个人呢！」`),
        ],
        [
          lines("PRINTFORMDL", 650, `桑尼抓住了${context.masterName}的手在。`),
          lines("PRINTFORMW", 651, "「来吧、随你喜欢的尽情地摸吧！」"),
        ],
        [
          lines("PRINTFORML", 656, "「我的头发非常柔顺漂亮对吧？」"),
          lines("PRINTFORMW", 657, "「啊、还不可以放开！在摸一摸嘛！」"),
        ],
      ], rng.int(3)),
    },
    {
      id: "sunny.head-pat.affection",
      on: "command.completed",
      priority: 60,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 309 && context.relationshipStage === "affection",
      lines: (context, rng) => pick([
        [
          lines("PRINTFORMDL", 665, "像是梳着一样抚摸着桑尼的金发、闻到了淡淡的柑橘味香气。"),
          lines("PRINTFORMW", 666, "「是因为之前吃了很多蜜柑吗？」"),
        ],
        [
          lines("PRINTFORMDL", 662, `桑尼闭上了眼睛享受着被${context.masterName}抚摸。`),
          lines("PRINTFORMW", 663, `「${context.masterName}的手摸着很舒服呢…」`),
        ],
        [
          lines("PRINTFORML", 668, "「被抚摸着很舒服呢！」"),
          lines("PRINTFORMDW", 669, "桑尼被抚摸着脸上露出了灿烂的笑容。"),
        ],
      ], rng.int(3)),
    },
    {
      id: "sunny.head-pat.ordinary",
      on: "command.completed",
      priority: 10,
      when: (context) => context.trigger.kind === "command.completed" && context.trigger.commandNo === 309,
      lines: (_context, rng) => pick([
        [
          lines("PRINTFORML", 677, "「啊、头感觉昏昏沉沉的～！」"),
          lines("PRINTFORMW", 678, "「不要那么用劲摸我啊ー！」"),
        ],
        [
          lines("PRINTFORML", 674, "「嗯嗯ー、这感觉还说得过去呢」"),
          lines("PRINTFORMDW", 675, "桑尼像是讨价还价一般点着头被抚摸着。"),
        ],
        [
          lines("PRINTFORML", 680, "「好痛痛…头发要变得乱蓬蓬了啊！」"),
          lines("PRINTFORMW", 681, "「真是的ー明明有好好梳理了的」"),
        ],
      ], rng.int(3)),
    },
    {
      id: "sunny.on-lap.time-stopped",
      on: "command.completed",
      priority: 100,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 336 && context.timeStopped,
      lines: () => [],
    },
    {
      id: "sunny.on-lap.angry",
      on: "command.completed",
      priority: 90,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 336 && context.relationship.angry,
      lines: (context) => [
        lines("PRINTFORMW", 896, "「姆咔！Masterーspark！！」"),
        lines("PRINTFORMDW", 897, `桑尼的头槌撞到了${context.masterName}的肚子里…。`),
      ],
    },
    {
      id: "sunny.on-lap.love",
      on: "command.completed",
      priority: 70,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 336 &&
        (context.relationshipStage === "love" || context.relationshipStage === "lover"),
      lines: (context, rng) => pick([
        [
          lines("PRINTFORML", 904, "「呼ー…呼ー…」"),
          lines("PRINTFORMDL", 905, `桑尼是躺在${context.masterName}的膝盖上睡着了。`),
          lines("PRINTFORMDW", 906, "…就这样待到她睡醒为止吧。"),
        ],
        [
          lines("PRINTFORMDL", 901, "像羽毛一样轻的桑尼甚至让你产生了她没有躺在你膝盖上的错觉。"),
          lines("PRINTFORMW", 902, "「唔嗯ー好幸福ー♪」"),
        ],
        [lines("PRINTFORMW", 908, `「和${context.masterName}待在一起、就像沐浴在阳光下一样安心哇…」`)],
      ], rng.int(3)),
    },
    {
      id: "sunny.on-lap.affection",
      on: "command.completed",
      priority: 60,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 336 && context.relationshipStage === "affection",
      lines: (context, rng) => pick([
        [
          lines("PRINTFORML", 916, `「在这里抬头看${context.masterName}的脸总觉得很不可思议呢ー」`),
          lines("PRINTFORMW", 917, "「啊、下巴下面有便当哟！」"),
        ],
        [
          lines("PRINTFORML", 913, `「啊、能听到${context.masterName}的心跳声呢！」`),
        ],
        [
          lines("PRINTFORML", 919, "「…我很可爱？…是吗？欸嘿嘿ー♪」"),
          lines("PRINTFORMDW", 920, `桑尼微笑着仰望着${context.masterName}。`),
        ],
      ], rng.int(3)),
    },
    {
      id: "sunny.on-lap.ordinary",
      on: "command.completed",
      priority: 10,
      when: (context) => context.trigger.kind === "command.completed" && context.trigger.commandNo === 336,
      lines: (context, rng) => pick([
        [
          lines("PRINTFORMDL", 928, "桑尼是因为头睡不安稳吗一直在调整着头的位置。"),
          lines("PRINTFORMW", 929, `「${context.masterName}的膝盖就像是木枕头一样硬啊」`),
        ],
        [
          lines("PRINTFORML", 925, "「露娜和斯塔的膝枕话更舒服哇！」"),
          lines("PRINTFORMDW", 926, "桑尼按住了头马上从你的膝枕上离开了。"),
        ],
        [lines("PRINTFORMW", 931, "「受伤了晒太阳还说得过去、只是睡觉也太无聊了…」")],
      ], rng.int(3)),
    },
    {
      id: "sunny.toast.great-success",
      on: "command.completed",
      priority: 30,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 334 && context.command.selection === "greatSuccess",
      lines: () => [lines("PRINTFORMW", 832, "「啊~哈~哈ー♪那么再一次干~杯！」")],
    },
    {
      id: "sunny.toast.success",
      on: "command.completed",
      priority: 20,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 334 && context.command.selection === "success",
      lines: (context) => [lines("PRINTFORMW", 835, `「${context.masterName}快喝快喝♪」`)],
    },
    {
      id: "sunny.toast.failure",
      on: "command.completed",
      priority: 10,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 334 && context.command.selection === "failure",
      lines: () => [lines("PRINTFORMW", 838, "「不喝喝我的酒吗ー？」")],
    },
    {
      id: "sunny.drugged-tea.great-success",
      on: "command.completed",
      priority: 40,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 331 && context.command.resolutionOverride === "greatSuccess",
      lines: () => [
        lines("PRINTFORML", 706, "「正好啊！我有点口渴了！」"),
        lines("PRINTFORMDW", 707, "桑尼毫不犹豫的喝下了泡药的茶。"),
      ],
    },
    {
      id: "sunny.drugged-tea.success",
      on: "command.completed",
      priority: 30,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 331 && context.command.resolutionOverride === "success",
      lines: () => [
        lines("PRINTFORML", 709, "「这个茶有一种不可思议的味道呢？看起来…」"),
        lines("PRINTFORMW", 710, "「是换了茶叶呢！偶尔尝下这种味道也不错呢」"),
      ],
    },
    {
      id: "sunny.drugged-tea.failure",
      on: "command.completed",
      priority: 20,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 331 && context.command.resolutionOverride === "failure",
      lines: () => [
        lines("PRINTFORML", 712, "「唔、这个味道好苦…」"),
        lines("PRINTFORMW", 713, "「是茶叶腐烂了么这个…？」"),
      ],
    },
    {
      id: "sunny.drugged-tea.other",
      on: "command.completed",
      priority: 10,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 331 && context.command.resolutionOverride === "other",
      lines: (context) => [
        lines("PRINTFORML", 715, "「现在不渴了！」"),
        lines("PRINTFORMW", 716, `「${context.masterName}你也可以喝哟！」`),
      ],
    },
    {
      id: "sunny.drink.liked",
      on: "command.completed",
      priority: 20,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 332 && context.drink.preference === "liked",
      lines: (context, rng) => pick([
        [
          lines("PRINTFORML", 742, "「虽然看起来是这样的幼女但是我们可是藏不住的酒鬼哦！」"),
          lines("PRINTFORMW", 743, "「所以说再来一杯！」"),
        ],
        [
          lines("PRINTFORML", 739, "「噗哈！这个清酒很好喝呐」"),
          lines("PRINTFORMW", 740, "「要是有烤八目鳗或者关东煮就好了呢」"),
        ],
        [
          lines("PRINTFORML", 745, `「${context.masterName}拿的真是好酒呢！」`),
          lines("PRINTFORMW", 746, "「告诉我在哪里买的吧！我要去那个店里偷一些！」"),
        ],
      ], rng.int(3)),
    },
    {
      id: "sunny.drink.disliked",
      on: "command.completed",
      priority: 10,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 332 && context.drink.preference === "disliked",
      lines: (_context, rng) => pick([
        [
          lines("PRINTFORML", 754, "「总觉得不太好…」"),
          lines("PRINTFORMW", 755, "「因为是喝不惯的酒吧？」"),
        ],
        [
          lines("PRINTFORML", 751, "「嗯ー味道好是挺好的」"),
          lines("PRINTFORMW", 752, "「可能是我不太适应这酒呢」"),
        ],
        [lines("PRINTFORML", 757, "「我想起了抓妖精陷阱里的廉价酒的味道…」")],
      ], rng.int(3)),
    },
    {
      id: "sunny.care.great-success",
      on: "command.completed",
      priority: 30,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 335 && context.command.selection === "greatSuccess",
      lines: (context) => [lines("PRINTFORMW", 864, `「呜ー…谢谢你${context.masterName}」`)],
    },
    {
      id: "sunny.care.success",
      on: "command.completed",
      priority: 20,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 335 && context.command.selection === "success",
      lines: () => [lines("PRINTFORMW", 867, "「啊、头好痛好痛的ー…」")],
    },
    {
      id: "sunny.care.failure",
      on: "command.completed",
      priority: 10,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 335 && context.command.selection === "failure",
      lines: () => [lines("PRINTFORMW", 870, "「姆Q…呜呼…」")],
    },
    {
      id: "sunny.tea.time-stopped-or-angry",
      on: "command.completed",
      priority: 100,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 301 && (context.timeStopped || context.relationship.angry),
      lines: () => [],
    },
    {
      id: "sunny.tea.love",
      on: "command.completed",
      priority: 70,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 301 &&
        (context.relationshipStage === "love" || context.relationshipStage === "lover"),
      lines: (context, rng) => pick([
        [
          lines("PRINTFORML", 114, "「滋滋…嗯、很美味！」"),
          lines("PRINTFORMW", 115, `「只要是${context.masterName}泡的、什么都好喝！」`),
        ],
        [lines("PRINTFORMW", 117, "「呐、下次也教我怎么泡出好喝的茶吧！」")],
        [
          lines("PRINTFORML", 119, "「本来我想给你泡茶的ー」"),
          lines("PRINTFORMDW", 120, "桑尼一边说着一边喝着茶。"),
        ],
        [lines("PRINTFORMW", 122, "「恶作剧结束后来杯茶的感觉真的没话说哇！」")],
      ], rng.int(4)),
    },
    {
      id: "sunny.tea.affection",
      on: "command.completed",
      priority: 60,
      when: (context) => context.trigger.kind === "command.completed" &&
        context.trigger.commandNo === 301 && context.relationshipStage === "affection",
      lines: (_context, rng) => pick([
        [lines("PRINTFORMW", 128, "「这次的甜包子甜得可怕了」")],
        [
          lines("PRINTFORML", 130, "「露娜是咖啡党吧」"),
          lines("PRINTFORMW", 131, "「每天都在早上喝咖啡。皮肤说不定会变黑呢」"),
        ],
        [lines("PRINTFORMW", 133, "「恶作剧之余喝的茶是最棒的哇！」")],
      ], rng.int(3)),
    },
    {
      id: "sunny.tea.ordinary",
      on: "command.completed",
      priority: 10,
      when: (context) => context.trigger.kind === "command.completed" && context.trigger.commandNo === 301,
      lines: (_context, rng) => pick([
        [lines("PRINTFORMW", 139, "「恶作剧前的茶的味道是特别的呢」")],
        [
          lines("PRINTFORML", 141, "「泡茶给我什么的、不是很机灵嘛…好烫！」"),
          lines("PRINTFORMW", 142, "「茶太烫了！你太不机灵了！！」"),
        ],
        [lines("PRINTFORMW", 144, "「啊啊ー暖和起来了」")],
      ], rng.int(3)),
    },
  ],
};

/** Attach the generated K5 asset family after the hand-audited semantic
 * overrides above. The source ASTs are build outputs, never read from ERB at
 * runtime, so Browser and Tauri resolve the identical authored data. */
export function createSunnyNativeDialoguePack(assets: SunnyNativeDialogueAssets): CharacterDialoguePack {
  return {
    ...SUNNY_NATIVE_DIALOGUE_PACK,
    rules: SUNNY_NATIVE_DIALOGUE_PACK.rules.map((rule) => ({
      ...rule,
      when: (context) =>
        (context.trigger.kind !== "command.completed" || context.trigger.commandKind === "COM") &&
        rule.when(context),
    })),
    claims: (trigger) => SUNNY_NATIVE_DIALOGUE_PACK.claims(trigger) || sunnyAssetClaims(assets, trigger),
    resolve: (context, rng) => resolveSunnyAsset(assets, context, rng),
    resolveInteractive: (context, rng, choices) => resolveSunnyAssetInteractive(assets, context, rng, choices),
  };
}
