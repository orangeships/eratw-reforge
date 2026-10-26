import { EXP_ID } from "./settlement.js";

export type HPositionExperienceChannel = "v" | "a";

export interface HPositionExperienceSlot {
  readonly id: number;
  readonly channel: HPositionExperienceChannel;
  readonly pose: number;
  readonly label?: string;
  readonly status: "source-backed" | "reserved";
}

const SOURCE_BACKED: readonly Omit<HPositionExperienceSlot, "status">[] = [
  { id: EXP_ID.正常位Ｖ絶頂経験, channel: "v", pose: 1, label: "正常位Ｖ絶頂経験" },
  { id: EXP_ID.後背位Ｖ絶頂経験, channel: "v", pose: 2, label: "後背位Ｖ絶頂経験" },
  { id: EXP_ID.騎乗位Ｖ絶頂経験, channel: "v", pose: 3, label: "騎乗位Ｖ絶頂経験" },
  { id: EXP_ID.対面座位Ｖ絶頂経験, channel: "v", pose: 4, label: "対面座位Ｖ絶頂経験" },
  { id: EXP_ID.背面座位Ｖ絶頂経験, channel: "v", pose: 5, label: "背面座位Ｖ絶頂経験" },
  { id: EXP_ID.正常位Ａ絶頂経験, channel: "a", pose: 1, label: "正常位Ａ絶頂経験" },
  { id: EXP_ID.後背位Ａ絶頂経験, channel: "a", pose: 2, label: "後背位Ａ絶頂経験" },
  { id: EXP_ID.騎乗位Ａ絶頂経験, channel: "a", pose: 3, label: "騎乗位Ａ絶頂経験" },
  { id: EXP_ID.対面座位Ａ絶頂経験, channel: "a", pose: 4, label: "対面座位Ａ絶頂経験" },
  { id: EXP_ID.背面座位Ａ絶頂経験, channel: "a", pose: 5, label: "背面座位Ａ絶頂経験" },
  { id: EXP_ID.小人飞机杯Ｖ绝顶经验, channel: "v", pose: 6, label: "小人飞机杯Ｖ绝顶经验" },
  { id: EXP_ID.背面骑乘式Ｖ绝顶经验, channel: "v", pose: 7, label: "背面骑乘式Ｖ绝顶经验" },
  { id: EXP_ID.站立正常式Ｖ绝顶经验, channel: "v", pose: 8, label: "站立正常式Ｖ绝顶经验" },
  { id: EXP_ID.站立后入式Ｖ绝顶经验, channel: "v", pose: 9, label: "站立后入式Ｖ绝顶经验" },
  { id: EXP_ID.火车便当式Ｖ绝顶经验, channel: "v", pose: 11, label: "火车便当式Ｖ绝顶经验" },
  { id: EXP_ID.抱起后入式Ｖ绝顶经验, channel: "v", pose: 12, label: "抱起后入式Ｖ绝顶经验" },
  { id: EXP_ID.站式小人飞机杯Ｖ绝顶经验, channel: "v", pose: 13, label: "站式小人飞机杯Ｖ绝顶经验" },
  { id: EXP_ID.小人飞机杯Ａ绝顶经验, channel: "a", pose: 6, label: "小人飞机杯Ａ绝顶经验" },
  { id: EXP_ID.背面骑乘式Ａ绝顶经验, channel: "a", pose: 7, label: "背面骑乘式Ａ绝顶经验" },
  { id: EXP_ID.站立正常式Ａ绝顶经验, channel: "a", pose: 8, label: "站立正常式Ａ绝顶经验" },
  { id: EXP_ID.站立后入式Ａ绝顶经验, channel: "a", pose: 9, label: "站立后入式Ａ绝顶经验" },
  { id: EXP_ID.火车便当式Ａ绝顶经验, channel: "a", pose: 11, label: "火车便当式Ａ绝顶经验" },
  { id: EXP_ID.抱起后入式Ａ绝顶经验, channel: "a", pose: 12, label: "抱起后入式Ａ绝顶经验" },
  { id: EXP_ID.站式小人飞机杯Ａ绝顶经验, channel: "a", pose: 13, label: "站式小人飞机杯Ａ绝顶经验" },
];

const sourceById = new Map(SOURCE_BACKED.map((row) => [row.id, row]));

function slotCoordinates(id: number): Pick<HPositionExperienceSlot, "channel" | "pose"> {
  if (id <= 105) return { channel: "v", pose: id - 100 };
  if (id <= 110) return { channel: "a", pose: id - 105 };
  if (id <= 130) return { channel: "v", pose: id - 105 };
  return { channel: "a", pose: id - 125 };
}

/** Complete upstream EXP.csv/AutoConst_EXP map for ids 101–150, including holes. */
export const H_POSITION_EXPERIENCE_TABLE: Readonly<Record<number, HPositionExperienceSlot>> =
  Object.freeze(Object.fromEntries(
    Array.from({ length: 50 }, (_, offset) => {
      const id = 101 + offset;
      const coordinates = slotCoordinates(id);
      const source = sourceById.get(id);
      return [id, {
        id,
        ...coordinates,
        ...(source?.label ? { label: source.label } : {}),
        status: source ? "source-backed" as const : "reserved" as const,
      } satisfies HPositionExperienceSlot];
    }),
  ));

/** Return only an EXP slot named by the upstream tables. Reserved ids stay empty. */
export function hPositionExperienceId(
  pose: number,
  channel: HPositionExperienceChannel,
): number | undefined {
  if (!Number.isInteger(pose) || pose < 1 || pose > 25) return undefined;
  const id = channel === "v"
    ? pose <= 5 ? pose + 100 : pose + 105
    : pose <= 5 ? pose + 105 : pose + 125;
  const slot = H_POSITION_EXPERIENCE_TABLE[id];
  return slot?.status === "source-backed" && slot.pose === pose && slot.channel === channel
    ? slot.id
    : undefined;
}
