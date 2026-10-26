import { useEffect } from "react";
import ScreenRouter from "./ScreenRouter";
import { usePresentationMode } from "./state/presentation-mode";
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
  createTrainMessageRouter,
  setRelationTable,
  setCharaDataTable,
  setCharaCstrTable,
  setTalentCatalog,
  setGiftCatalog,
  setFortuneCatalog,
  setItemExplanations,
} from "../../modernization/runtime";
import type {
  DialogueRouter,
  RelationTable,
  TrainMessageBundle,
} from "../../modernization/runtime";
import type { SharedCounterDialogueAssets } from "../../modernization/runtime/kojo/counter-dispatch.js";
import { setStallItemNames } from "../../modernization/runtime/state/stall-performance.js";
import charasBundle from "./game/charas.bundle.json";
import relationBundle from "./game/relation.bundle.json";
import charaDataBundle from "./game/chara-data.bundle.json";
import giftCatalogBundle from "./game/gift-catalog.bundle.json";
import fortuneCatalogBundle from "./game/fortune-catalog.bundle.json";
import talentCatalogBundle from "./game/talent-catalog.bundle.json";
import itemExplanationsBundle from "./game/item-explanations.bundle.json";
import itemsBundle from "./game/items.bundle.json";
import charaMoveSpotsBundle from "./game/chara-move-spots.bundle.json";
import type { AgentIntent } from "../../modernization/schemas/types.js";
import { seedRoomNeighbors } from "../../modernization/runtime/world/scheduler.js";
import { setCharaMoveSpotTable } from "../../modernization/runtime/world/chara-move-spots.js";
import { setDishMenu } from "../../modernization/runtime/state/dish-menu.js";
import dishesBundle from "./game/dishes.bundle.json";
import scenesBundleImport from "./game/scenes.bundle.json";
import trainMessageBundle from "./game/train-message.bundle.json";
import sharedCounterBundle from "./game/shared-counter.native-dialogue.json";
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

// 存档修复 (2026-07-02): the new-game wizard doesn't require selecting an eraTW
// project, so a player can play a full game with lastPath=null. When no project
// is selected we key the save file by this stable constant instead — otherwise
// there'd be no key to 存档 to and every relaunch forced 新游戏. (The Rust side
// hashes the key into a filename, so any non-empty string is a valid key.)
const DEFAULT_SAVE_KEY = "eratw-default-game";

/**
 * Routers are memoized per locally authorized Kojo source. This keeps the
 * parsed KojoCache alive across UI state changes without bundling authored
 * dialogue into the public repository or player package.
 * A failed creation deletes its entry so a later effect run can retry.
 */
const memoizedKojoRouters = new Map<string, Promise<DialogueRouter>>();

function getMemoizedKojoRouter(key: string, create: () => Promise<DialogueRouter>): Promise<DialogueRouter> {
  let router = memoizedKojoRouters.get(key);
  if (!router) {
    router = create();
    memoizedKojoRouters.set(key, router);
    router.catch(() => memoizedKojoRouters.delete(key));
  }
  return router;
}

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
  const presentationMode = usePresentationMode();
  const tauriRuntime = hasTauriRuntime();
  const kojoSourceValidation = useKojoSourceStore((s) => s.validation);
  const loadInitialKojoSource = useKojoSourceStore((s) => s.loadInitial);
  const gameState = useGameStateStore((s) => s.state);
  const restoreGameState = useGameStateStore((s) => s.restore);
  const saveGameState = useGameStateStore((s) => s.save);
  const applyIntentAction = useGameStateStore((s) => s.applyIntentAction);
  const walkPathAction = useGameStateStore((s) => s.walkPathAction);
  const resolveWalkEncounterAction = useGameStateStore((s) => s.resolveWalkEncounterAction);
  const finishSleepAction = useGameStateStore((s) => s.finishSleepAction);
  const resolveDailyEventPromptAction = useGameStateStore((s) => s.resolveDailyEventPromptAction);
  const recoverDailyEventSessionAction = useGameStateStore((s) => s.recoverDailyEventSessionAction);
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
  const setPortraitVariant = useGameStateStore((s) => s.setPortraitVariantAction);
  const togglePantyGapAuto = useGameStateStore((s) => s.togglePantyGapAutoAction);
  const claimPantyCollectionBonus = useGameStateStore((s) => s.claimPantyCollectionBonusAction);
  const sellPantyDuplicates = useGameStateStore((s) => s.sellPantyDuplicatesAction);
  const runNarrativeDirector = useGameStateStore((s) => s.runNarrativeDirectorAction);
  const lastSavedAt = useGameStateStore((s) => s.lastSavedAt);
  const saveSlots = useGameStateStore((s) => s.saveSlots);
  const refreshSaveSlots = useGameStateStore((s) => s.refreshSaveSlots);
  const newGame = useGameStateStore((s) => s.newGame);
  const listNewGameKojoUpdatesAction = useGameStateStore((s) => s.listNewGameKojoUpdatesAction);
  const resolveNewGameKojoUpdateAction = useGameStateStore((s) => s.resolveNewGameKojoUpdateAction);
  const setScreen = useSceneStore((s) => s.setScreen);
  const screen = useSceneStore((s) => s.screen);

  useEffect(() => {
    void hydrateAiSettings();
  }, []);

  // Dialogue starts fail-closed. Desktop players authorize their own eraTW
  // source and Tauri reads it locally through KojoCache. Browser builds cannot
  // access local files and therefore keep authored dialogue disabled.
  useEffect(() => {
    const callNames = buildCallNames();
    const trainMessageRouter = createTrainMessageRouter(
      trainMessageBundle as TrainMessageBundle,
      { callNames },
    );
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
    setFortuneCatalog(fortuneCatalogBundle);
    // 採集/調合/道具页 说明文: inject the 186 `@ITEM_EXPLANATION_<id>` 地文 once.
    setItemExplanations(
      itemExplanationsBundle as unknown as Parameters<typeof setItemExplanations>[0],
    );
    // 做饭 P1: inject the DISHDATA 料理 menu (179 通用菜) once (static data).
    setDishMenu(dishesBundle as unknown as Parameters<typeof setDishMenu>[0]);
    setStallItemNames(Object.fromEntries(Object.values(itemsBundle.byId).map((entry) => [entry.id, entry.name])));
    let cancelled = false;
    configureIntent({
      dialogueRouter: NOOP_KOJO_ROUTER,
      trainMessageRouter,
      counterSharedAssets: sharedCounterBundle as SharedCounterDialogueAssets,
      counterEnabled: false,
      callNames,
    });

    const selectedSource = kojoSourceValidation?.kojoRoot;
    if (tauriRuntime && selectedSource) {
      void (async () => {
        try {
          const kojoRoot = await addKojoSourceScope(selectedSource);
          const router = await getMemoizedKojoRouter(kojoRoot, async () => {
            const { createTauriKojoCacheRouter } = await import("./game/tauri-kojo-cache.js");
            return await createTauriKojoCacheRouter({ kojoRoot, callNames });
          });
          if (cancelled) return;
          configureIntent({
            dialogueRouter: router,
            trainMessageRouter,
            counterSharedAssets: sharedCounterBundle as SharedCounterDialogueAssets,
            counterEnabled: true,
            callNames,
          });
          console.log(
            `[eraTW] local KojoCache wired (${kojoRoot}, ${Object.keys(callNames).length} callNames)`,
          );
        } catch (error) {
          if (!cancelled) {
            console.warn("[eraTW] local KojoCache unavailable; dialogue remains disabled:", error);
          }
        }
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [kojoSourceValidation?.kojoRoot, tauriRuntime]);

  // Restore the locally authorized Kojo source and the stable player save.
  useEffect(() => {
    if (tauriRuntime) void loadInitialKojoSource();
  }, [loadInitialKojoSource, tauriRuntime]);

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

  useEffect(() => {
    void restoreGameState(DEFAULT_SAVE_KEY);
  }, [restoreGameState]);

  // 存档/读档 (实玩反馈 2026-06-28): saving is now EXPLICIT — there is no
  // per-change autosave. This matches the original eraTW (manual SAVE/LOAD)
  // and is what makes 读档 meaningful: 存档 writes the file, 读档 restores it,
  // so the player can save a point, do something, and load back. The persisted
  // file is also what 继续游戏 (and the boot load below) reads.

  const canPlay = gameState !== null;
  const needsKojoSourceSetup = tauriRuntime && !kojoSourceValidation?.isValid;

  const handleCommand = (intent: AgentIntent): void => {
    applyIntentAction(intent);
  };

  const handleWalkPath = (rooms: string[]): void => {
    walkPathAction(rooms);
  };

  const handleFinishSleep = async (): Promise<void> => {
    // A4 — the deterministic night settlement synchronously sweeps ~256 kojo
    // source files; cold ones go through the blocking sync reader and used to
    // freeze the settlement frame for seconds. Give the router's background
    // preload a bounded chance to finish first. On timeout or failure the
    // sync fallback runs exactly as before (best-effort, never blocks play).
    try {
      const { ensureNightSourcesPreloaded } = await import("./game/tauri-kojo-cache.js");
      await Promise.race([
        ensureNightSourcesPreloaded(),
        new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
      ]);
    } catch {
      // Preload gate is best-effort only.
    }
    finishSleepAction();
  };

  const handleOpenEyes = async (): Promise<void> => {
    const store = useGameStateStore.getState();
    // Day-break waits for the whole nightly AI barrier to settle (character
    // reflections / diaries / plans plus automatic L3). The morning
    // menu keeps rendering its progress while we wait; the [100] button is
    // disabled during the wait, so this await mostly covers the completion
    // race. `abandonNightCycleAction` (「不再等待」) settles it via cancel.
    await store.awaitNightCycle();
    openEyesAction();
  };

  const saveKey = DEFAULT_SAVE_KEY;

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
    // Minimal mode skips the multi-screen identity/kojo/residence/options
    // wizard, but still collects the protagonist's name and compact traits.
    setScreen(presentationMode === "minimal" ? "minimalNewGame" : "newGameSetup");
  };

  // 极简模式: commit the default draft + entered name/player-facing traits.
  // Residence is 神社:居間; gender/shape/abilities/kojo keep DEFAULT_DRAFT.
  // UPDATE_K 角色初始化 runs in the
  // BACKGROUND (auto-pass; authored pause points skip that character the same
  // way the UI's 跳过 does — fail-closed, no half effects) and the screen goes
  // straight to the morning menu — the 口上更新环节 is not shown.
  const handleMinimalEnterGame = (): void => {
    usePreGameStore.getState().setDraft({ homeLocation: "神社:居間" });
    newGame(usePreGameStore.getState().draft);
    const store = useGameStateStore.getState();
    for (const candidate of store.listNewGameKojoUpdatesAction()) {
      const result = store.resolveNewGameKojoUpdateAction(candidate.charaNum);
      if (result?.status === "pending") continue; // 作者暂停 → 跳过该角色
    }
    setScreen("morningMenu");
  };

  // 就此开始吧 — commit the wizard draft into a fresh GameState (称呼/性別/
  // 居住地/开始前设定). After state creation, run the selected characters'
  // UPDATE_K initialization before entering morningMenu (= 原版 BEGIN SHOP).
  const handleEnterGame = (): void => {
    newGame(usePreGameStore.getState().draft);
    setScreen("kojoUpdate");
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
  const inOpeningFlow =
    screen === "title" ||
    screen === "minimalNewGame" ||
    screen === "newGameSetup" ||
    screen === "kojoSelect" ||
    screen === "residenceSelect" ||
    screen === "newGameOptions" ||
    screen === "kojoUpdate";

  if (needsKojoSourceSetup) {
    return (
      <main className="container">
        <KojoSourceSetup />
      </main>
    );
  }

  return (
    <main className={
      inGame
        ? `container container--fullscreen${presentationMode === "minimal" ? " container--minimal" : ""}`
        : inOpeningFlow
          ? "container container--opening"
          : "container"
    }>
      {!inGame && (
        <header className="app-header">
          <h1>eraTW</h1>
        </header>
      )}

      <ScreenRouter
        canBrowse={true}
        gameState={gameState}
        presentationMode={presentationMode}
        onIntent={handleCommand}
        onWalkPath={handleWalkPath}
        onResolveWalkEncounter={resolveWalkEncounterAction}
        onFinishSleep={handleFinishSleep}
        onResolveDailyEvent={resolveDailyEventPromptAction}
        onRecoverDailyEvent={recoverDailyEventSessionAction}
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
        onSetPortraitVariant={setPortraitVariant}
        onTogglePantyGapAuto={togglePantyGapAuto}
        onClaimPantyCollectionBonus={claimPantyCollectionBonus}
        onSellPantyDuplicates={sellPantyDuplicates}
        onTriggerManualNarrative={async (playerIntent) => {
          return await runNarrativeDirector({
            allowFree: true,
            playerIntent,
            manual: true,
          });
        }}
        onStartGame={handleStartGame}
        onMinimalNewGameStart={handleMinimalEnterGame}
        onEnterGame={handleEnterGame}
        onListNewGameKojoUpdates={listNewGameKojoUpdatesAction}
        onResolveNewGameKojoUpdate={resolveNewGameKojoUpdateAction}
        canPlay={canPlay}
      />
    </main>
  );
}
