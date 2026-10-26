import type { CharacterDialoguePack } from "../native-dialogue.js";
import {
  generatedAssetClaims,
  resolveGeneratedAsset,
  resolveGeneratedAssetInteractive,
  type GeneratedNativeDialogueAssets,
  type SharedCounterDialogueAssets,
  type SharedEventDialogueAssets,
  type SharedMarkDialogueAssets,
  type SharedPalamDialogueAssets,
  type SharedSpEventDialogueAssets,
} from "./generated-assets.js";

function pick<T>(values: readonly T[], index: number): T {
  return values[index % values.length]!;
}

function lines(
  form: "PRINTFORML" | "PRINTFORMW" | "PRINTFORMD" | "PRINTFORMDL" | "PRINTFORMDW",
  line: number,
  text: string,
) {
  return { form, line, text } as const;
}

/** Overseas Aunn's authored `M_KOJO_EGG_ENCOUNTER_K120` first meeting. Empty
 * PRINTFORM calls and FONTITALIC/FONTREGULAR directives have no displayed
 * text, so they are intentionally absent from the native transcript. */
export const AUNN_OVERSEAS_NATIVE_DIALOGUE_PACK: CharacterDialoguePack = {
  charaNum: 120,
  variantId: "1",
  claims: (trigger) => trigger.kind === "character.firstMet" ||
    (trigger.kind === "command.completed" &&
      (trigger.commandNo === 360 || trigger.commandNo === 361)),
  rules: [
    {
      id: "aunn-overseas.first-met.shrine-guardian",
      on: "character.firstMet",
      priority: 100,
      when: () => true,
      lines: (context) => [
        lines("PRINTFORML", 109, "「你好～！你是来神社参拜的吗？」"),
        lines("PRINTFORMDW", 110, "当你在神社境内四处闲逛时，突然有个充满活力的陌生声音向你搭话。"),
        lines("PRINTFORMDW", 111, "转身寻找声源的你，发现了正在挥手的少女。"),
        lines("PRINTFORMDW", 113, "少女有着海泡石色的长发，发梢以狂野的弧度向内侧卷曲环绕着头部和肩膀。"),
        lines("PRINTFORMDW", 114, "灰色圆筒状的角从头顶伸出，耳朵也有着相似的造型。"),
        lines("PRINTFORMDW", 115, "光是这些特征就足够引人注目了，但她的装束更加让人移不开眼。"),
        lines("PRINTFORMDW", 116, "她穿着红色短袖琉球衫，衣服上装饰着云纹图案。"),
        lines("PRINTFORMDW", 117, "短裤与上衣采用相同的花纹配色，但图案方向是上下颠倒的。"),
        lines("PRINTFORML", 119, "「...哎呀，难道说你不知道我吗？这可不行呢～！」"),
        lines("PRINTFORML", 120, "「我是高丽野阿吽，是狛犬哦！最近刚获得知性的守护兽！」"),
        lines("PRINTFORMW", 121, "「如你所见，我的工作就是守护这座神社！」"),
        lines("PRINTFORMDW", 122, "阿吽误解了你观察的视线，带着灿烂的笑容开始自我介绍。"),
        lines("PRINTFORMDL", 123, "你感受到她是个性格开朗且直率的女孩。"),
        lines("PRINTFORML", 125, "「那么你是...？」"),
        lines("PRINTFORMDW", 126, "你立刻进行了自我介绍。"),
        lines("PRINTFORML", 128, `「啊，那${context.masterName}先生！」`),
        lines("PRINTFORMW", 129, "「博丽神社今后也请多关照啦～！」"),
        lines("PRINTFORMDW", 131, "阿吽挥着手告别，重新回到守护神社的岗位上..."),
        lines("PRINTFORMDW", 133, "你正要挥手回应时，突然飘来的纸片啪地贴在了脸上遮蔽了视野。"),
        lines("PRINTFORMDW", 134, "揭下纸片后发现上面写着文字。"),
        lines("PRINTFORMD", 137, "关于阿吽的详细信息请阅读"),
        lines("PRINTFORMD", 139, "ERB\\ 口上・メッセージ関連\\ 个人口上\\ 120 Aunn [あうん] \\ 阿吽海外版"),
        lines("PRINTFORMDL", 140, "文件夹内的README.txt"),
        lines("PRINTFORMDW", 142, "你虽然搞不清状况，但还是把这张纸随手扔掉了..."),
      ],
    },
    {
      id: "aunn-overseas.yield",
      on: "command.completed",
      priority: 100,
      when: (context) => context.trigger.kind === "command.completed" && context.trigger.commandNo === 360,
      lines: (_context, rng) => pick([
        [lines("PRINTFORML", 8776, "「很好…只要老实服从我就万事大吉了！」")],
        [lines("PRINTFORML", 8778, "「对～就这样顺着我的任性来吧～！」")],
        [
          lines("PRINTFORML", 8780, "「这么顺从的你最棒了～！」"),
          lines("PRINTFORMW", 8781, "「这样我就能尽情享受了！」"),
        ],
      ], rng.int(3)),
    },
    {
      id: "aunn-overseas.resist",
      on: "command.completed",
      priority: 100,
      when: (context) => context.trigger.kind === "command.completed" && context.trigger.commandNo === 361,
      lines: (_context, rng) => pick([
        [
          lines("PRINTFORML", 8802, "「不挣扎的话会更舒服哦～咱保证～！」"),
          lines("PRINTFORML", 8803, "「所以嘛...乖乖服从守护兽的意愿如何？」"),
        ],
        [
          lines("PRINTFORML", 8805, "「嗯？不喜欢这样吗？」"),
          lines("PRINTFORML", 8806, "「真遗憾，咱反而更想这么做了哟！」"),
        ],
        [
          lines("PRINTFORML", 8808, "「呼呼...就算反抗...」"),
          lines("PRINTFORML", 8809, "「咱也能用另一个我来按住你呢！」"),
        ],
      ], rng.int(3)),
    },
  ],
};

/**
 * Compose the hand-audited overseas overrides with the complete indexed
 * source asset. The authored overrides keep priority for first-meeting and
 * the two overseas response commands; every other indexed route is resolved
 * by the generated asset and remains fail-closed when unsupported.
 */
export function createAunnOverseasNativeDialoguePack(
  assets: GeneratedNativeDialogueAssets,
  sharedCounterAssets: SharedCounterDialogueAssets,
  sharedEventAssets: SharedEventDialogueAssets,
  sharedPalamAssets: SharedPalamDialogueAssets,
  sharedSpEventAssets: SharedSpEventDialogueAssets,
  sharedMarkAssets: SharedMarkDialogueAssets,
): CharacterDialoguePack {
  return {
    ...AUNN_OVERSEAS_NATIVE_DIALOGUE_PACK,
    claims: (trigger) => AUNN_OVERSEAS_NATIVE_DIALOGUE_PACK.claims(trigger) || generatedAssetClaims(assets, trigger),
    resolve: (context, rng) => resolveGeneratedAsset(
      assets,
      context,
      rng,
      sharedCounterAssets,
      sharedEventAssets,
      sharedPalamAssets,
      sharedSpEventAssets,
      sharedMarkAssets,
    ),
    resolveInteractive: (context, rng, choices) => resolveGeneratedAssetInteractive(
      assets,
      context,
      rng,
      choices,
      sharedCounterAssets,
      sharedEventAssets,
      sharedPalamAssets,
      sharedSpEventAssets,
      sharedMarkAssets,
    ),
  };
}
