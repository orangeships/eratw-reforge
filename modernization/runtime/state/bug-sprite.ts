/**
 * 斗虫字符画精灵 — per-insect ASCII sprites.
 *
 * Visual language follows the existing scene art (`ASCII-SCENE-ART.md`):
 * pure `#000` ground, characters as the only geometry, form drawn with strokes
 * rather than density fills (a filled 34x20 cell collapses into noise at the
 * house font size), and a strict half-width grid so the sprite lands on the
 * `--era-mono` rhythm from `ascii-ui.css`.
 *
 * ## Why these are hand-authored
 *
 * An earlier revision generated every species procedurally — ellipses and lines
 * parameterised by tribe, type and size. It produced technically distinct,
 * deterministic, correctly-sized output that nobody could identify as an insect.
 * Shape is what carries meaning here: a beetle only reads as a beetle if you can
 * see the split elytra, six jointed legs and the pronotum. So every family is
 * drawn by hand at 34x20, and species within a family share the drawing with a
 * deterministic variation pass (wing spots, band count, size).
 *
 * Layout is safe by construction: sprites are pure ASCII (plus a few CJK-free
 * box-free glyphs) so indentation never depends on Ambiguous-width fonts.
 */

import { BUG_CATALOG, bugDefFor, type BugDef } from "./bug-catching.js";

/** A character-grid sprite. Rows are equal-length; shorter rows are padded. */
export interface BugSprite {
  /** Species number this sprite was drawn for. */
  bugNum: number;
  width: number;
  height: number;
  rows: readonly string[];
}

/**
 * Standard sprite canvas. Every family is normalised to exactly this size so
 * the battle frame can indent any sprite by the same amount and the roster
 * never jitters between species.
 */
export const SPRITE_W = 42;
export const SPRITE_H = 20;

/** Deterministic 32-bit hash of a species number, used for every variation. */
function seedOf(bugNum: number): number {
  let h = (bugNum * 2654435761) >>> 0;
  h ^= h >>> 15;
  h = (Math.imul(h, 2246822519) >>> 0);
  h ^= h >>> 13;
  return h >>> 0;
}

/** Pick `count` stable integers in `[min, max]` from a species seed. */
function pick(seed: number, count: number, min: number, max: number): number[] {
  const out: number[] = [];
  let s = seed || 1;
  for (let i = 0; i < count; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out.push(min + (s % Math.max(1, max - min + 1)));
  }
  return out;
}

/**
 * Normalise a hand-drawn block to the standard canvas.
 *
 * Hand-drawn sheets are eyeballed, so rows drift past the target width and the
 * block count drifts past the target height. Clamping here (rather than hand
 * fixing 20 blocks) keeps every sprite exactly `SPRITE_W x SPRITE_H`, which is
 * what lets the battle frame indent them uniformly.
 */
function make(bugNum: number, block: readonly string[]): BugSprite {
  const rows: string[] = [];
  for (let y = 0; y < SPRITE_H; y++) {
    const raw = block[y] ?? "";
    rows.push(raw.length > SPRITE_W ? raw.slice(0, SPRITE_W) : raw.padEnd(SPRITE_W, " "));
  }
  return { bugNum, width: SPRITE_W, height: SPRITE_H, rows };
}

// ---------------------------------------------------------------------------
// Hand-drawn families
//
// Every drawing is 34 wide so the battle frame can indent one uniformly.
// ---------------------------------------------------------------------------

/** 蝶 — four solid wings, clubbed antennae, segmented abdomen. */
const BUTTERFLY = [
  "     .-----.             .-----.     ",
  "   .'@@@@@@@'.         '.@@@@@@@'.   ",
  "  /@@@@@@@@@@@\       /@@@@@@@@@@@\  ",
  " |@@@@%@@@@@@@@@\   /@@@@@@@@%@@@@@| ",
  " |@@@%@@@@@@@@@@@\|@@@@@@@@@@@%@@@@| ",
  " |@@@@@@@@@@@@@@@#@@@@@@@@@@@@@@@@@| ",
  " |@@@#@@@@@@@@@@@@@@@@@@@@@@@@@@@@#@| ",
  "  \@@@##@@@@@@@@@@@@@@@@@@@@@@@@@##/  ",
  "   '.@@@###@@@@@@@@@@@@@@@@@@@@@@#@.'   ",
  "     '@@@@#@@\    |    /@@#@@@@@@@'     ",
  "       '@@@@@\   |   /@@@@@@@@@'       ",
  "         '@@@\  |  /@@@@@@@'           ",
  "           '@\ | /@@@@@@'             ",
  "             \|/@@@'                  ",
  "              |                       ",
  "             \|/                      ",
  "            _|_                       ",
  "          .' | '.                     ",
  "         /   |   \                    ",
  "        /____|____\                   ",
];

/** 蜻 — two long wing pairs, huge eyes, needle abdomen. */
const DRAGONFLY = [
  "    ________________________     ",
  " __/                        \\__  ",
  "/       ____________             \\ ",
  "|      /            \\            |",
  "|   __/              \\__          |",
  "|  /      ____  ____    \\         |",
  "| |      / o  \\/  o \\     |        |",
  "|  \\     \\____/\\____/     /        |",
  "|   \\__              __/           |",
  " \\       \\__________/            / ",
  "  \\__                        __/   ",
  "    \\________________________/    ",
  "              \\  /                 ",
  "               \\/                  ",
  "               /\\                  ",
  "              /  \\                 ",
  "             /    \\                ",
  "            /      \\               ",
  "           /________\\              ",
  "                                ",
];

/** 蝉 — roofed wings folded over the back, wide head, short antennae. */
const CICADA = [
  "        \\                 /      ",
  "         \\_______________/       ",
  "        /                 \\      ",
  "       /                   \\     ",
  "      |    .###########.    |    ",
  "      |   /  # # # # #  \\   |    ",
  "      |  |   #  # #  #   |  |    ",
  "      |  |   #  # #  #   |  |    ",
  "      |   \\  # # # #  /   |    ",
  "      |    '###########'    |    ",
  "       \\      #######      /     ",
  "        \\     #####     /      ",
  "         \\    #####    /       ",
  "          \\   #####   /        ",
  "           \\  #####  /         ",
  "            \\ ##### /          ",
  "             \\###/            ",
  "              \\#/             ",
  "               |               ",
  "                                ",
];

/** 甲虫 — domed elytra split down the midline, pronotum, six legs. */
const BEETLE = [
  "        .############.           ",
  "      .'##############'.         ",
  "     /##################\\        ",
  "    /####%####|####%####\\       ",
  "   |#####%####|####%#####|      ",
  "   |#####%####|####%#####|      ",
  "   |######%###|###%######|      ",
  "    \\######%##|##%######/       ",
  "     \\#################/        ",
  "      '.##############.'         ",
  "        '#####|#####'           ",
  "           ###|###              ",
  "          /    |    \\           ",
  "      /##/     |     \\##\\       ",
  "     /####/    |    \\####\\      ",
  "    /######/   |   \\######\\     ",
  "    \\_______/___|___\\_______/    ",
  "                                ",
  "                                ",
  "                                ",
  "                                ",
];

/** 锹形虫 — the antler mandibles are the whole silhouette. */
const STAG = [
  "  \\                          / ",
  "   \\                        /  ",
  "    \\__                  __/   ",
  "       \\      ########  /      ",
  "        \\    /        \\/       ",
  "         \\  |  ####|   |       ",
  "          | | ######|  |        ",
  "          | | ######|  |        ",
  "          | | ######|  |        ",
  "          | | ######|  |        ",
  "           \\  \\######/  /        ",
  "            \\  \\####/  /         ",
  "             \\  \\__/  /          ",
  "          /\\  |    |  /\\         ",
  "         /  \\ |    | /  \\        ",
  "        /    \\|    |/    \\       ",
  "       /######\\    /######\\      ",
  "       \\_______/____\\_______/     ",
  "                                ",
  "                                ",
];

/** 兜虫 — one enormous horn, heavy rounded body. */
const RHINO = [
  "            /\\                  ",
  "           /  \\                 ",
  "          /    \\                ",
  "         /      \\               ",
  "        /   ##   \\              ",
  "       |  ######  |             ",
  "      /  ########  \\            ",
  "     |  ##########  |           ",
  "     | ############# |           ",
  "      \\ ########### /            ",
  "       \\ ######### /             ",
  "        \\  #####  /              ",
  "         \\  ###  /               ",
  "          \\  #  /                ",
  "        /\\  |  \\  /\\           ",
  "       /  \\ |  | /  \\          ",
  "      /#####\\  |/#####\\         ",
  "      \\______________/          ",
  "                                ",
  "                                ",
];

/** 蝗虫 — folded wing case, tapered abdomen, oversized hind legs. */
const GRASSHOPPER = [
  "         \\________             ",
  "      ___/        \\___         ",
  "    _/     ##        \\_        ",
  "   /     ######        \\       ",
  "  |     ##%###         |      ",
  "  |    ##o###o##       |      ",
  "  |     ######        |       ",
  "   \\     ######      /        ",
  "    \\___ ######  ___/         ",
  "        \\########/            ",
  "   _____/      \\_____         ",
  "  /              \\__\\        ",
  " /                  \\        ",
  " \\                  /        ",
  "  \\____    ______  /         ",
  "       \\__/      \\__/          ",
  "         /        \\            ",
  "        /          \\           ",
  "       /____________\\          ",
  "                                ",
];

/** 水棲 — flattened oval shell with paddle legs. */
const AQUATIC = [
  "           ___________           ",
  "        .-'           '-.        ",
  "      .'                 '.      ",
  "     /     ###########     \\     ",
  "    |    ###  #####  ###    |    ",
  "    |   ##              ##   |    ",
  "    |   ##   ##  ##  ###   |    ",
  "    |   ##              ##   |    ",
  "    |    ###  #####  ###    |    ",
  "     \\     ###########     /     ",
  "      '.                 .'      ",
  "        '-.___________.-'        ",
  "      _/                   \\_    ",
  "     /                         \\   ",
  "    /                           \\  ",
  "   /                             \\ ",
  "  /                               \\",
  " /                                 \\",
  "/___________________________________\\",
  "                                ",
];

/** 甲殻類 — two big claws, four pairs of walking legs. */
const CRUSTACEAN = [
  "   ___                     ___   ",
  "  /   \\                   /   \\  ",
  " |  ##  |                 |  ##  | ",
  " |  ##  |_________________|  ##  | ",
  "  \\___/                     \\___/  ",
  "        \\   ##########   /        ",
  "         \\  ##########  /         ",
  "          |  ##  ##  ##  |         ",
  "          |  ##########  |         ",
  "          |  ##########  |         ",
  "           \\  ########  /          ",
  "        /\\/\\/\\  \\####/  /\\/\\/\\    ",
  "       /      \\  \\##/  /      \\   ",
  "      /        \\  ||  /        \\  ",
  "     /__________\\ || /__________\\ ",
  "                 \\||/               ",
  "                  ||                ",
  "                  ||                ",
  "                 \\||/               ",
  "                                ",
];

/** 青蛙 — squat body, bulging eye-bumps, folded hind legs. */
const FROG = [
  "        ####            ####      ",
  "      .######.        .######.    ",
  "     /  o    o \\____/  o    o \\   ",
  "     \\  ###### /    \\  ######  /   ",
  "      '######/      \\######'     ",
  "    .-'#########----#########'-.  ",
  "   /###########################\\ ",
  "  |############################_|",
  "  |#####%####################%###|",
  "  |#####%####################%###|",
  "   \\############################/ ",
  "    '-.######################_.-'  ",
  "   /###\\####################/###\\ ",
  "  /#####\\##################/#####\\",
  " \\#######\\################/#######/",
  "  \\#######\\##############/#######/ ",
  "   \\_______\\____________/_______/  ",
  "                                ",
  "                                ",
  "                                ",
];

/** 蛛 — eight jointed legs; the count is the whole read. */
const SPIDER = [
  "          ########              ",
  "        .##########.            ",
  "       /  o      o  \\           ",
  "       |   ########   |          ",
  "        \\  ########  /           ",
  "         '.########.'             ",
  "    \\                /           ",
  "     \\    ########    /          ",
  "      \\  /        \\  /           ",
  "       \\/          \\/            ",
  "       |            |            ",
  "       |   ########  |            ",
  "        \\  ########  /            ",
  "         '.########.'             ",
  "    /                \\           ",
  "     \\    ########    /          ",
  "      \\  /        \\  /           ",
  "       \\/          \\/            ",
  "        \\          /             ",
  "         \\        /              ",
];

/** 蝎 — pincers forward, segmented tail arched over the back. */
const SCORPION = [
  "            ______              ",
  "         .-'      '-.           ",
  "      .-'            '-.        ",
  "  ___|    ########    |___      ",
  " /   \\   /        \\   /   \\     ",
  "|  ##  | |   ####   | |  ##  |    ",
  "|  ##  | |   ####   | |  ##  |    ",
  " \\_____/  \\________/  \\_____/    ",
  "    \\                         /    ",
  "     \\      ########      /     ",
  "      \\    /        \\    /      ",
  "       \\  |  ##  ##  |  /       ",
  "        |  |        |  |        ",
  "         \\  \\______/  /         ",
  "          \\          /          ",
  "   \\        |        |        / ",
  "    \\_______|________|_______/  ",
  "            \\  |  /              ",
  "             \\ | /               ",
  "                                ",
];

/** 蜈蚣 — long annulated body, one leg pair per segment. */
const CENTIPEDE = [
  "  ____________________________   ",
  " /##o##o##o##o##o##o##o##o##o##\\  ",
  " \\____________________________/  ",
  "  |  |  |  |  |  |  |  |  |  |   ",
  "  |  |  |  |  |  |  |  |  |  |   ",
  "   \\  \\  \\  \\  \\  \\  \\  \\  \\   ",
  "    \\  \\  \\  \\  \\  \\  \\  \\  \\   ",
  "     \\  \\  \\  \\  \\  \\  \\  \\  \\  ",
  "      \\  \\  \\  \\  \\  \\  \\  \\  \\ ",
  "                                ",
  "  ____________________________   ",
  " /##o##o##o##o##o##o##o##o##o##\\  ",
  " \\____________________________/  ",
  "  |  |  |  |  |  |  |  |  |  |   ",
  "   \\  \\  \\  \\  \\  \\  \\  \\  \\   ",
  "    \\  \\  \\  \\  \\  \\  \\  \\  \\   ",
  "     \\  \\  \\  \\  \\  \\  \\  \\  \\  ",
  "      \\  \\  \\  \\  \\  \\  \\  \\  \\ ",
  "                                ",
  "                                ",
];

/** 蠕 — long, evenly annulated, legless. */
const WORM = [
  "          .-----.                ",
  "       .-'       '-.             ",
  "     .'    ###      '.           ",
  "    /   #########     \\          ",
  "   |   ###     ###      |         ",
  "   |   ###     ###      |         ",
  "   |   #########       |          ",
  "    \\      ###        /           ",
  "     '.             .'            ",
  "       '-._______.-'              ",
  "     ____________________         ",
  "    /####################\\        ",
  "    \\####################/        ",
  "     \\__________________/         ",
  "                                ",
  "       __________________         ",
  "      /##################\\        ",
  "      \\__________________/         ",
  "                                ",
  "                                ",
];

/** 螺 — spiral shell, eyestalks. */
const SNAIL = [
  "              ######            ",
  "           .##########.         ",
  "         .####.####.####.       ",
  "        /###.########.####\\      ",
  "       |###.##########.####|     ",
  "       |##.##############.##|    ",
  "        \\###.############.##/    ",
  "         '.################.'     ",
  "           '##############'      ",
  "   | |                             ",
  "   | |_______________________     ",
  "    \\                            \\",
  "     \\____________________________\\",
  "                                ",
  "                                ",
  "                                ",
  "                                ",
  "                                ",
  "                                ",
  "                                ",
];

/** 爬虫類 — domed carapace, head, four legs. */
const TURTLE = [
  "          ##########            ",
  "      ___/############\\___       ",
  "    .'                    '.     ",
  "   /     .############.     \\    ",
  "  |     /   ##########\\   |    ",
  "  |    |    ##  o   o ##|   |    ",
  "  |     \\   ##########/   |    ",
  "   \\     '############'     /    ",
  "    '.                    .'     ",
  "      \\__________________/      ",
  "   ___/                      \\___ ",
  "  /                              \\",
  "  \\                              /",
  "   \\____________________________/",
  "                                ",
  "                                ",
  "                                ",
  "                                ",
  "                                ",
  "                                ",
];

/** 機械 — rotor arc, angular chassis, articulated legs. */
const MECHANICAL = [
  "   . . . . . . . . . . . .      ",
  " .                               .",
  "        \\      ########      /    ",
  "         \\    /        \\    /     ",
  "          |  |  ######  |  |      ",
  "          |  |  ##  ##  |  |      ",
  "          |  |  ######  |  |      ",
  "          |   \\________/   |      ",
  "          |       ||       |      ",
  "          |       ||       |      ",
  "        / |       ||       | \\    ",
  "       /  |_______||_______|  \\   ",
  "      /              ||        \\  ",
  "     /                ||         \\ ",
  "    /                  ||          \\",
  "   /                    ||           \\",
  "  /                      ||            ",
  "                                ",
  "                                ",
  "                                ",
];

/** 蜂 — banded abdomen, two veined wings, fuzzy thorax. */
const BEE = [
  "       \\              /          ",
  "        \\   ########  /           ",
  "         \\ /          \\            ",
  "          /            \\           ",
  "         |    o  o      |          ",
  "          \\   ######   /           ",
  "           \\ ######## /            ",
  "            \\########/             ",
  "             \\======/              ",
  "              \\====/               ",
  "               \\==/                ",
  "                \\/                 ",
  "               /  \\                ",
  "              /    \\               ",
  "             /      \\              ",
  "            /        \\             ",
  "           /__________\\            ",
  "                                ",
  "                                ",
  "                                ",
];

/** 幼体 / 軟体 — plump segmented grub. */
const LARVA = [
  "           .######.              ",
  "        .############.           ",
  "       /####  o  o ####\\          ",
  "      |#####      #####|         ",
  "       \\##############/          ",
  "        '.############.'           ",
  "          '.######.'             ",
  "            .####.               ",
  "           /######\\              ",
  "          /###==###\\             ",
  "         |###==.==###|            ",
  "         |###==.==###|            ",
  "          \\###==###/             ",
  "           \\######/              ",
  "            \\####/               ",
  "             \\##/                ",
  "              ||                 ",
  "              ||                 ",
  "             \\||/                ",
  "                                ",
];

/** 通用兜底 — a generic six-legged insect. */
const GENERIC = [
  "           .######.              ",
  "        .-'########'-.           ",
  "       /###  o  o  ###\\          ",
  "      |#####    ######|          ",
  "       \\##############/           ",
  "        '.##########.'            ",
  "          '.######.'              ",
  "        /###########\\             ",
  "       /             \\            ",
  "   /##/               \\##\\        ",
  "  /####\\               /####\\      ",
  " |######\\             /######|     ",
  "  \\#######\\         /#######/      ",
  "   \\_______\\_______/_______/       ",
  "                                ",
  "                                ",
  "                                ",
  "                                ",
  "                                ",
  "                                ",
];
// ---------------------------------------------------------------------------
// Family resolution
// ---------------------------------------------------------------------------

/**
 * Name-based archetypes, checked BEFORE the tribe column.
 *
 * The upstream tribe tags are incomplete in ways that matter here: cicadas
 * (`蝉`, species 41-45) are tagged only `[飛行]`, so a tag-only lookup would draw
 * them as generic fliers; `[多脚]` lumps millipedes together with spiders and
 * scorpions, which are different silhouettes entirely; and 金龟 is a scarab
 * beetle, so a naive `龟` match would call 艳金龟 a reptile.
 */
const NAME_ARCHETYPES: ReadonlyArray<readonly [string, string]> = [
  ["蝉", "蝉"],
  ["蜻蜓", "蜻"],
  ["蝎子", "蝎"],
  ["蜘蛛", "蛛"],
  ["跳蛛", "蛛"],
  ["蟹", "甲殻類"],
  ["虾", "甲殻類"],
  ["龙虾", "甲殻類"],
  ["鲎", "甲殻類"],
  ["彩龟", "爬虫類"],
  ["陆龟", "爬虫類"],
  ["蛇", "爬虫類"],
  ["蜥", "爬虫類"],
  ["蜗牛", "螺"],
  ["蚯蚓", "蠕"],
  ["涡虫", "蠕"],
  ["水蛭", "蠕"],
  ["蜜蜂", "蜂"],
  ["熊蜂", "蜂"],
];

const TRIBE_ARCHETYPES: ReadonlyArray<readonly [string, string]> = [
  ["蝶", "蝶"],
  ["蜻", "蜻"],
  ["兜虫", "兜虫"],
  ["锹形虫", "锹形虫"],
  ["甲虫", "甲虫"],
  ["蝉", "蝉"],
  ["幼体", "幼体"],
  ["蝎", "蝎"],
  ["蛛", "蛛"],
  ["螺", "螺"],
  ["蠕", "蠕"],
  ["軟体", "軟体"],
  ["青蛙", "青蛙"],
  ["甲殻類", "甲殻類"],
  ["水棲", "水棲"],
  ["蝗虫", "蝗虫"],
  ["多脚", "多脚"],
  ["爬虫類", "爬虫類"],
  ["機械", "機械"],
  ["蜜蜂", "蜂"],
  ["飛行", "通用"],
];

/** Resolve the drawing family for a species. */
export function bugArchetype(def: BugDef): string {
  for (const [needle, family] of NAME_ARCHETYPES) {
    if (def.name.includes(needle)) return family;
  }
  const tags = [...def.tribe.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]!);
  for (const [tag, family] of TRIBE_ARCHETYPES) {
    if (tags.includes(tag)) return family;
  }
  return "通用";
}

const FAMILY_ART: Readonly<Record<string, readonly string[]>> = {
  蝶: BUTTERFLY,
  蜻: DRAGONFLY,
  蝉: CICADA,
  甲虫: BEETLE,
  锹形虫: STAG,
  兜虫: RHINO,
  蝗虫: GRASSHOPPER,
  水棲: AQUATIC,
  甲殻類: CRUSTACEAN,
  青蛙: FROG,
  蛛: SPIDER,
  蝎: SCORPION,
  多脚: CENTIPEDE,
  蠕: WORM,
  螺: SNAIL,
  爬虫類: TURTLE,
  機械: MECHANICAL,
  蜂: BEE,
  幼体: LARVA,
  軟体: LARVA,
  通用: GENERIC,
};

/**
 * Per-species variation applied to the family drawing.
 *
 * Two species in the same family must still differ on screen — but a *random
 * scatter* of marks lands in the gaps between wings and shreds the silhouette.
 * So every variation here is **anchored**: it rewrites a fixed set of cells
 * inside a known body part. Same guarantees, no collateral damage.
 */
function vary(block: readonly string[], family: string, seed: number): string[] {
  const [a, b] = pick(seed, 2, 0, 2);
  const rows = [...block];
  /** Overwrite one cell, if it is inside the row and currently blank. */
  const dot = (y: number, x: number, ch: string): void => {
    const row = rows[y];
    if (row === undefined) return;
    const chars = [...row];
    if (x < 0 || x >= chars.length) return;
    if (chars[x] === " ") chars[x] = ch;
    rows[y] = chars.join("");
  };

  switch (family) {
    // Four wing eyespots, one per wing, at fixed interior coordinates.
    case "蝶": {
      const marks: readonly (readonly [number, number])[] = [
        [3, 5], [3, 27], [10, 7], [10, 25],
      ];
      for (const [y, x] of marks) dot(y, x, a === 0 ? "o" : "*");
      // Wing-tip sparkle.
      dot(2, 4 + b, "*");
      break;
    }
    case "蜻": {
      for (const [y, x] of [[6, 7], [6, 25], [7, 8], [7, 24]] as const) dot(y, x, a === 0 ? "o" : "*");
      // Body stripe count.
      dot(13 + b, 16, a === 0 ? "=" : "*");
      break;
    }
    case "蝉": {
      for (const [y, x] of [[5, 12], [5, 18], [6, 11], [6, 19]] as const) dot(y, x, a === 0 ? "o" : "*");
      dot(8 + b, 16, "*");
      break;
    }
    // Abdomen bands: heavier insects get a solid `=` band, lighter a dashed one.
    case "蜂": {
      for (let i = 0; i <= b; i++) dot(8 + i * 2, 13, a === 0 ? "=" : "-");
      break;
    }
    // Elytral midline and pronotum sheen.
    case "甲虫": {
      dot(5, 17, a === 0 ? "=" : "*");
      dot(6, 17, "=");
      break;
    }
    // Centipede: more segments for a denser body.
    case "多脚": {
      const width = 33 - b * 3;
      rows[0] = "  " + "_".repeat(width) + " ";
      rows[1] = " /  " + "o ".repeat(Math.max(3, Math.floor(width / 2))).slice(0, width) + " \\";
      rows[2] = " \\" + "_".repeat(width) + "/";
      break;
    }
    // Carapace pattern.
    case "爬虫類": {
      dot(5, 15 + b, a === 0 ? "=" : "*");
      dot(6, 17, ".");
      break;
    }
    default:
      break;
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const SPRITE_CACHE = new Map<number, BugSprite>();

/** Draw the sprite for a species. Deterministic and cached. */
export function bugSprite(bugNum: number): BugSprite {
  const cached = SPRITE_CACHE.get(bugNum);
  if (cached) return cached;

  const def = bugDefFor(bugNum);
  const family = def ? bugArchetype(def) : "通用";
  const art = FAMILY_ART[family] ?? GENERIC;
  const sprite = make(bugNum, vary(art, family, seedOf(bugNum)));

  SPRITE_CACHE.set(bugNum, sprite);
  return sprite;
}

/** Standard on-screen size of a battle sprite, for layout maths. */
export const BATTLE_SPRITE_WIDTH = SPRITE_W;
export const BATTLE_SPRITE_HEIGHT = SPRITE_H;

/** Count of hand-drawn families available. */
export const FAMILY_COUNT = Object.keys(FAMILY_ART).length;

/**
 * A compact one-line roster stamp, e.g. `菜粉蝶 R12 ★★ G型`.
 * Used where a full sprite would not fit.
 */
export function bugStamp(def: BugDef, rank: number, gType: boolean, xType: boolean): string {
  const stars = rank > 0 ? "★".repeat(Math.min(8, Math.max(1, Math.ceil(rank / 12)))) : "";
  const mut = `${gType ? "G" : ""}${xType ? "X" : ""}`;
  return `${def.name} R${rank}${stars ? ` ${stars}` : ""}${mut ? ` ${mut}` : ""}`;
}

/** Sanity helper for tests: every catalogued species must produce a usable sprite. */
export function spriteCoverage(): { species: number; drawn: number; families: number } {
  let drawn = 0;
  for (const bug of BUG_CATALOG) {
    const sprite = bugSprite(bug.num);
    if (sprite.rows.length > 0 && sprite.rows.some((row) => row.trim().length > 0)) drawn++;
  }
  return { species: BUG_CATALOG.length, drawn, families: FAMILY_COUNT };
}
