import { useEffect } from "react";
import ScreenRouter from "./ScreenRouter";
import type { GamePresentationMode } from "./game/GameClient";
import { useKojoSourceStore } from "./state/kojo-source-store";
import { useGameStateStore } from "./state/game-state-store";
import type { SaveSlot } from "./ipc/tauri-bridge";
import { useSceneStore } from "./state/scene-store";
import { usePreGameStore } from "./state/pre-game-store";
import {
  ping,
  addKojoSourceScope,
  hasTauriRuntime,
} from "./ipc/tauri-bridge";
import {
  configureIntent,
  setRelationTable,
  setCharaDataTable,
  setCharaCstrTable,
  setTalentCatalog,
  setGiftCatalog,
} from "../../modernization/runtime";
import type {
  DialogueRouter,
  TrainMessageRouter,
  RelationTable,
} from "../../modernization/runtime";
import charasBundle from "./game/charas.bundle.json";
import relationBundle from "./game/relation.bundle.json";
import charaDataBundle from "./game/chara-data.bundle.json";
import giftCatalogBundle from "./game/gift-catalog.bundle.json";
import talentCatalogBundle from "./game/talent-catalog.bundle.json";
import charaMoveSpotsBundle from "./game/chara-move-spots.bundle.json";
import type { AgentIntent } from "../../modernization/schemas/types.js";
import { seedRoomNeighbors } from "../../modernization/runtime/world/scheduler.js";
import { setCharaMoveSpotTable } from "../../modernization/runtime/world/chara-move-spots.js";
import { setDishMenu } from "../../modernization/runtime/state/dish-menu.js";
import dishesBundle from "./game/dishes.bundle.json";
import scenesBundleImport from "./game/scenes.bundle.json";
import { hydrateAiSettings } from "./ai/store.js";
import KojoSourceSetup from "./game/pre/KojoSourceSetup.js";

// Seed the multi-map roam engine with in-map exits from every built map
// so non-shrine residents actually move (Bug fix 2026-07-04).
seedRoomNeighbors(scenesBundleImport as ReadonlyArray<{ location: string; exits: ReadonlyArray<{ toLocation: string }> }>);

// Seed the per-chara ODEKAKE spot whitelist (CHARAMOVE_DATA_NN(7, P_ID) parse)
// so `encounter.ts::canAppearAtSpot` can filter out spots the upstream data
// forbids each chara from spawning at.
setCharaMoveSpotTable(charaMoveSpotsBundle as Parameters<typeof setCharaMoveSpotTable>[0]);

const NOOP_KOJO_ROUTER: DialogueRouter = {
  collect: () => [],
  resolveEventKojo: () => [],
  resolveSpEventKojo: () => [],
  resolveIraiKojo: () => [],
};

const NOOP_TRAIN_MESSAGE_ROUTER: TrainMessageRouter = {
  collect: () => [],
};

const BROWSER_PLAYER_SAVE_KEY = "browser-player";

// 存档修复 (2026-07-02): the new-game wizard doesn't require selecting an eraTW
// project, so a player can play a full game with lastPath=null. When no project
// is selected we key the save file by this stable constant instead — otherwise
// there'd be no key to 存档 to and every relaunch forced 新游戏. (The Rust side
// hashes the key into a filename, so any non-empty string is a valid key.)
function buildCallNames(): Record<number, string> {
  const charas = charasBundle as Record<string, { callName?: string }>;
  const callNames: Record<number, string> = {};
  for (const [num, c] of Object.entries(charas)) {
    if (c.callName) callNames[Number(num)] = c.callName;
  }
  return callNames;
}

/**
 * App — Phase 4.5F.
 *
 * The Game Client is now the default surface. Rendering is driven by
 * `scene-store.screen` (S1 / A1): title -> pre-game flow -> mainGame,
 * `ScreenRouter` owns the screen→component map; this component owns the
 * player bootstrap, local Kojo authorization, and save/load effects.
 */
export default function App() {
  const presentationMode: GamePresentationMode = "classic";
  const tauriRuntime = hasTauriRuntime();
  const kojoSourceValidation = useKojoSourceStore((s) => s.validation);
  const gameState = useGameStateStore((s) => s.state);
  const restoreGameState = useGameStateStore((s) => s.restore);
  const saveGameState = useGameStateStore((s) => s.save);
  const applyIntentAction = useGameStateStore((s) => s.applyIntentAction);
  const walkPathAction = useGameStateStore((s) => s.walkPathAction);
  const resolveWalkEncounterAction = useGameStateStore((s) => s.resolveWalkEncounterAction);
  const finishSleepAction = useGameStateStore((s) => s.finishSleepAction);
  const resolveDailyEventPromptAction = useGameStateStore((s) => s.resolveDailyEventPromptAction);
  const openEyesAction = useGameStateStore((s) => s.openEyesAction);
  const buyCatalogItemAction = useGameStateStore((s) => s.buyCatalogItemAction);
  const useInventoryItemAction = useGameStateStore((s) => s.useInventoryItemAction);
  const setWakeMinuteAction = useGameStateStore((s) => s.setWakeMinuteAction);
  const setHomeLocationAction = useGameStateStore((s) => s.setHomeLocationAction);
  const resetCommissionsAction = useGameStateStore((s) => s.resetCommissionsAction);
  const resetClothesAction = useGameStateStore((s) => s.resetClothesAction);
  const releaseBugAction = useGameStateStore((s) => s.releaseBugAction);
  const materializeBugAction = useGameStateStore((s) => s.materializeBugAction);
  const toggleFilterAction = useGameStateStore((s) => s.toggleFilterAction);
  const togglePortraitKind = useGameStateStore((s) => s.togglePortraitKindAction);
  const lastSavedAt = useGameStateStore((s) => s.lastSavedAt);
  const saveSlots = useGameStateStore((s) => s.saveSlots);
  const refreshSaveSlots = useGameStateStore((s) => s.refreshSaveSlots);
  const newGame = useGameStateStore((s) => s.newGame);
  const setScreen = useSceneStore((s) => s.setScreen);
  const screen = useSceneStore((s) => s.screen);

  useEffect(() => {
    void hydrateAiSettings();
  }, []);

  // The player selects an original Kojo source directory for every desktop
  // session. Tauri reads it locally and builds parsed nodes lazily in KojoCache;
  // plain browser builds cannot access local files and keep dialogue disabled.
  useEffect(() => {
    const callNames = buildCallNames();
    // 拠点来訪 来訪連鎖: inject the 相性 (RELATION) table once (static data).
    setRelationTable(relationBundle as RelationTable);
    // 角色情报看板硬骨头批: 5 个静态数据面一次性注入。
    //  - chara-data: キャラデータ 感性/料理 + CSTR (介绍文 + 工作情報)
    //  - gift-catalog: 187 本体 + 593 形容词 (REVIEW_GIFT + CREATE_GIFT)
    //  - talent-catalog: 181 素质名 + 5 类有序 id (素质6分类 + GET_TALENTNAME)
    setCharaDataTable(charaDataBundle as unknown as Record<number, never>);
    setCharaCstrTable(charasBundle as unknown as Record<number, { CSTR?: Record<string, string> }>);
    setTalentCatalog(
      talentCatalogBundle as unknown as { names: Record<string, string>; categories: Record<string, number[]> },
    );
    setGiftCatalog(
      giftCatalogBundle as unknown as {
        mains: Record<string, never>;
        adjects: Record<string, never>;
      },
    );
    // 做饭 P1: inject the DISHDATA 料理 menu (179 通用菜) once (static data).
    setDishMenu(dishesBundle as unknown as Parameters<typeof setDishMenu>[0]);
    let cancelled = false;

    configureIntent({
      dialogueRouter: NOOP_KOJO_ROUTER,
      trainMessageRouter: NOOP_TRAIN_MESSAGE_ROUTER,
      callNames,
    });

    const selectedSource = kojoSourceValidation?.kojoRoot;
    if (!tauriRuntime || !selectedSource) return () => { cancelled = true; };

    void (async () => {
      try {
        const kojoRoot = await addKojoSourceScope(selectedSource);
        const { createTauriKojoCacheRouter } = await import("./game/tauri-kojo-cache.js");
        if (cancelled) return;
        const router = await createTauriKojoCacheRouter({ kojoRoot, callNames });
        if (cancelled) return;
        configureIntent({ dialogueRouter: router, trainMessageRouter: NOOP_TRAIN_MESSAGE_ROUTER, callNames });
        console.log(
          `[eraTW] local KojoCache wired (${kojoRoot}, ${Object.keys(callNames).length} callNames)`,
        );
      } catch (e) {
        if (!cancelled) console.warn("[eraTW] local KojoCache unavailable; dialogue remains disabled:", e);
      }
    })();

    return () => { cancelled = true; };
  }, [kojoSourceValidation?.kojoRoot, tauriRuntime]);

  useEffect(() => {
    if (!tauriRuntime) {
      console.log("[eraTW] browser runtime: local filesystem integration disabled");
      return;
    }
    ping().then((reply) => {
      console.log("[eraTW] IPC ping reply:", reply);
    }).catch((e) => {
      console.warn("[eraTW] IPC ping skipped/failed:", e);
    });
  }, [tauriRuntime]);

  // Restore the single player save namespace.
  useEffect(() => {
    void restoreGameState(BROWSER_PLAYER_SAVE_KEY);
  }, [restoreGameState]);

  // 存档/读档 (实玩反馈 2026-06-28): saving is now EXPLICIT — there is no
  // per-change autosave. This matches the original eraTW (manual SAVE/LOAD)
  // and is what makes 读档 meaningful: 存档 writes the file, 读档 restores it,
  // so the player can save a point, do something, and load back. The persisted
  // file is also what 继续游戏 and the startup restore flow read.

  const canPlay = gameState !== null;
  const needsKojoSourceSetup = tauriRuntime && !kojoSourceValidation?.isValid;

  const handleCommand = (intent: AgentIntent): void => {
    applyIntentAction(intent);
  };

  const handleFinishSleep = (): void => {
    finishSleepAction();
  };

  const handleOpenEyes = (): void => {
    openEyesAction();
  };

  const saveKey = BROWSER_PLAYER_SAVE_KEY;

  // SAVE/LOAD 页面 — three manual slots. Each handler targets a specific slot;
  // 读档 restores that slot, replacing the live state.
  const handleSaveSlot = async (slot: SaveSlot): Promise<boolean> => {
    if (!saveKey) return false;
    return await saveGameState(saveKey, slot);
  };
  const handleLoadSlot = async (slot: SaveSlot): Promise<boolean> => {
    if (!saveKey) return false;
    return await restoreGameState(saveKey, slot);
  };
  const handleRefreshSlots = async (): Promise<void> => {
    if (!saveKey) return;
    await refreshSaveSlots(saveKey);
  };

  // 开始游戏 — begin the new-game wizard (#13). Reset the draft to NEWGAME
  // defaults and enter 身份设定; the flow runs identity → 口上 → 居住地.
  const handleStartGame = (): void => {
    usePreGameStore.getState().resetDraft();
    setScreen("newGameSetup");
  };

  // 就此开始吧 — commit the wizard draft into a fresh GameState (称呼/性別/
  // 居住地/开始前设定). 6b: 主角睡在自宅, 首屏进 morningMenu (= 原版 BEGIN SHOP)
  // 让玩家先看隙间商店/能力/SAVE, 再 [100] 睁眼 → mainGame.
  const handleEnterGame = (): void => {
    newGame(usePreGameStore.getState().draft);
    setScreen("morningMenu");
  };

  // The main game is the full-screen surface — no app chrome (the "eraTW"
  // header is for the pre-game / tool screens only).
  const inGame =
    screen === "mainGame" ||
    screen === "danmakuBattle" ||
    screen === "fishingGame" ||
    screen === "stoneContest" ||
    screen === "nightSettlement" ||
    screen === "morningMenu";

  if (needsKojoSourceSetup) {
    return (
      <main className="container">
        <KojoSourceSetup />
      </main>
    );
  }

  return (
    <main className={inGame ? "container container--fullscreen" : "container"}>
      {!inGame && (
        <header className="app-header">
          <h1>eraTW</h1>
        </header>
      )}

      <ScreenRouter
        gameState={gameState}
        presentationMode={presentationMode}
        onIntent={handleCommand}
        onWalkPath={walkPathAction}
        onResolveWalkEncounter={resolveWalkEncounterAction}
        onFinishSleep={handleFinishSleep}
        onResolveDailyEvent={resolveDailyEventPromptAction}
        onOpenEyes={handleOpenEyes}
        onSaveSlot={handleSaveSlot}
        onLoadSlot={handleLoadSlot}
        onRefreshSlots={handleRefreshSlots}
        saveSlots={saveSlots}
        onBuyCatalogItem={buyCatalogItemAction}
        onUseInventoryItem={useInventoryItemAction}
        onSetWakeMinute={setWakeMinuteAction}
        onSetHomeLocation={setHomeLocationAction}
        onResetCommissions={resetCommissionsAction}
        onResetClothes={resetClothesAction}
        onReleaseBug={releaseBugAction}
        onMaterializeBug={materializeBugAction}
        lastSavedAt={lastSavedAt}
        onToggleFilter={toggleFilterAction}
        onTogglePortraitKind={togglePortraitKind}
        onStartGame={handleStartGame}
        onEnterGame={handleEnterGame}
        canPlay={canPlay}
      />
    </main>
  );
}
