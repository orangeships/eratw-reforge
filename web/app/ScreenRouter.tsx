import { useState } from "react";

/**
 * Phase 4.5F — ScreenRouter.
 *
 * Maps `scene-store.screen` to the surface that renders it. Pure of
 * IPC: it reads the screen from the store and dispatches navigation
 * through `setScreen`, but the game-state / project effects live in
 * `App.tsx`. Decoupling routing from those effects keeps this fully
 * testable in jsdom (no Tauri mocks needed).
 *
 * The A1 split (S1) shows here: navigation between screens is
 * `setScreen` (UI-only); only `mainGame` reads the GameState (whose
 * location changed through the intent stream).
 */

import { useSceneStore } from "./state/scene-store.js";
import type { SaveSlot, SlotInfo } from "./ipc/tauri-bridge";
import GameClient from "./game/GameClient.js";
import type { GamePresentationMode } from "./game/GameClient.js";
import Title from "./game/pre/Title.js";
import NewGameSetup from "./game/pre/NewGameSetup.js";
import ResidenceSelect from "./game/pre/ResidenceSelect.js";
import KojoSelect from "./game/pre/KojoSelect.js";
import NewGameOptions from "./game/pre/NewGameOptions.js";
import NewGameKojoUpdate from "./game/pre/NewGameKojoUpdate.js";
import MinimalNewGameScreen from "./game/pre/MinimalNewGameScreen.js";
import NightSettlementScreen from "./game/NightSettlementScreen.js";
import MorningMenuScreen from "./game/MorningMenuScreen.js";
import DanmakuBattleScreen from "./game/DanmakuBattleScreen.js";
import FishingGameScreen from "./game/FishingGameScreen.js";
import StoneContestScreen from "./game/StoneContestScreen.js";
import FarmScreen from "./game/FarmScreen.js";
import type { GameState } from "../../modernization/runtime/state/index.js";
import type { ShopBuyResult } from "../../modernization/runtime/state/shop.js";
import type { WalkChoice } from "../../modernization/runtime/world/skip-move.js";
import type { AgentIntent } from "../../modernization/schemas/types.js";
import type { PromptAnswer } from "../../modernization/runtime/command/prompt.js";
import type {
  NewGameKojoUpdateCandidate,
  NewGameKojoUpdateResult,
} from "../../modernization/runtime/index.js";

export interface ScreenRouterProps {
  gameState: GameState | null;
  presentationMode?: GamePresentationMode;
  onIntent: (intent: AgentIntent) => void;
  /** Phase D (#9): walk a multi-hop map path (SKIP_MOVE) with pass-through
   *  encounters instead of teleporting. */
  onWalkPath?: (rooms: string[]) => void | Promise<void>;
  onPrepareKojoForLocations?: (locations: readonly string[]) => Promise<void>;
  /** Phase D slice 2: resolve the current mid-walk encounter (无视/打招呼/停下来). */
  onResolveWalkEncounter?: (choice: WalkChoice) => void;
  onFinishSleep?: () => void;
  onResolveDailyEvent?: (answer: boolean | PromptAnswer) => void;
  onRecoverDailyEvent?: () => void;
  onOpenEyes?: () => void | Promise<void>;
  /** SAVE/LOAD 页面 — 3 存档位. Save / load a specific slot; refresh reads all
   *  slots' metadata for the page. */
  onSaveSlot?: (slot: SaveSlot) => void | boolean | Promise<void | boolean>;
  onLoadSlot?: (slot: SaveSlot) => void | boolean | Promise<void | boolean>;
  onRefreshSlots?: () => void | Promise<void>;
  saveSlots?: SlotInfo[] | null;
  onBuyCatalogItem?: (itemId: number, qty?: number) => ShopBuyResult;
  onUseInventoryItem?: (itemId: number) => { ok: boolean; message: string };
  onSetWakeMinute?: (minute: number) => void;
  onSetHomeLocation?: (homeLocation: string) => void;
  /** SHOP [160] 重置委托 — clears active slots + per-chara 委托状況/内容状态. */
  onResetCommissions?: () => { resetSlots: number; resetFlags: number };
  /** SHOP [161] 重置服装 — restore NPC defaults + clear coordinate 1-99 (master excluded). */
  onResetClothes?: () => { resetNpcs: number; resetCoords: number };
  onReleaseBug?: (id: string) => boolean;
  onMaterializeBug?: (id: string) => boolean;
  onTogglePortraitKind?: () => void;
  onSetPortraitVariant?: (charaNum: number, variantId: number) => void;
  onTogglePantyGapAuto?: () => void;
  onClaimPantyCollectionBonus?: (id: number) => boolean;
  onSellPantyDuplicates?: () => number;
  onTriggerManualNarrative?: (playerIntent?: string) => Promise<boolean>;
  lastSavedAt?: number | null;
  /** Toggle an Act_COM filter (Parity QA P-1) for the focused target. */
  onToggleFilter?: (toggleId: number, target: number) => void;
  /** 开始游戏 — begin the new-game wizard (#13): reset the draft and enter
   *  身份设定. (The faithful NEWGAME opening: identity → 口上 → 居住地.) */
  onStartGame: () => void;
  /** Minimal mode: commit the default draft + entered name and enter the
   *  game (App: 神社:居間 default residence → newGame → kojoUpdate). */
  onMinimalNewGameStart?: () => void;
  /** Commit the wizard draft into a fresh GameState and enter the main game
   *  (the residence step's 就此开始吧). */
  onEnterGame: () => void;
  onListNewGameKojoUpdates?: () => NewGameKojoUpdateCandidate[];
  onResolveNewGameKojoUpdate?: (
    charaNum: number,
    choices?: readonly number[],
  ) => NewGameKojoUpdateResult | null;
  /** A valid project + a game state are available (gate 继续游戏 / mainGame). */
  canPlay: boolean;
  /** A valid project is selected (gate developer tools). */
  canBrowse: boolean;
}

export default function ScreenRouter(props: ScreenRouterProps) {
  const screen = useSceneStore((s) => s.screen);
  const setScreen = useSceneStore((s) => s.setScreen);
  const [morningInitialPanel, setMorningInitialPanel] = useState<"gap-shop" | null>(null);

  switch (screen) {
    case "title":
      return (
        <Title
          // 开始游戏 begins the new-game wizard (#13: identity → 口上 → 居住地).
          onStart={props.onStartGame}
          // SAVE/LOAD 都在「睁开眼睛前」主菜单进行（原版 morning SHOP），
          // 所以读档/继续游戏落到 morningMenu，而不是直接进 mainGame。
          onContinue={props.canPlay ? () => setScreen("morningMenu") : undefined}
          onLoadSlot={props.onLoadSlot}
          onRefreshSlots={props.onRefreshSlots}
          saveSlots={props.saveSlots}
          // PLAYER_BUILD hides the developer-tools entry point (4.5H).
          onDev={undefined}
        />
      );

    case "projectSelect":
      return null;

    case "minimalNewGame":
      return (
        <MinimalNewGameScreen
          onStart={props.onMinimalNewGameStart ?? (() => setScreen("kojoUpdate"))}
          onBack={() => setScreen("title")}
        />
      );

    case "newGameSetup":
      return (
        <NewGameSetup
          onNext={() => setScreen("kojoSelect")}
          onBack={() => setScreen("title")}
        />
      );

    case "kojoSelect":
      return (
        <KojoSelect
          onNext={() => setScreen("residenceSelect")}
          onBack={() => setScreen("newGameSetup")}
        />
      );

    case "residenceSelect":
      return (
        <ResidenceSelect
          onConfirm={() => setScreen("newGameOptions")}
          onBack={() => setScreen("kojoSelect")}
        />
      );

    case "newGameOptions":
      return (
        <NewGameOptions
          onDone={props.onEnterGame}
          onEditIdentity={() => setScreen("newGameSetup")}
          onEditResidence={() => setScreen("residenceSelect")}
          onBack={() => setScreen("residenceSelect")}
        />
      );

    case "kojoUpdate":
      return props.gameState ? (
        <NewGameKojoUpdate
          candidates={props.onListNewGameKojoUpdates?.() ?? []}
          onResolve={(charaNum, choices) =>
            props.onResolveNewGameKojoUpdate?.(charaNum, choices) ?? null}
          onDone={() => setScreen("morningMenu")}
        />
      ) : (
        <p data-testid="kojo-update-loading">正在准备角色剧本初始化…</p>
      );

    case "mainGame":
      return props.gameState ? (
        <GameClient
          state={props.gameState}
          presentationMode={props.presentationMode}
          sceneDialogue={true}
          onIntent={props.onIntent}
          onWalkPath={props.onWalkPath}
          onPrepareKojoForLocations={props.onPrepareKojoForLocations}
          onResolveWalkEncounter={props.onResolveWalkEncounter}
          onToggleFilter={props.onToggleFilter}
        />
      ) : (
        <p data-testid="maingame-loading">正在加载游戏状态…</p>
      );

    case "danmakuBattle":
      return props.gameState?.danmakuBattle ? (
        <DanmakuBattleScreen state={props.gameState} />
      ) : (
        <p data-testid="danmaku-loading">正在准备弹幕战…</p>
      );

    case "fishingGame":
      return props.gameState?.fishingGame || props.gameState?.fishingSettlement ? (
        <FishingGameScreen state={props.gameState} />
      ) : (
        <p data-testid="fishing-loading">正在准备钓场…</p>
      );

    case "stoneContest":
      return props.gameState?.stoneContestSession ? (
        <StoneContestScreen state={props.gameState} />
      ) : (
        <p data-testid="stone-contest-loading">正在准备积石赛场…</p>
      );

    case "farm":
      return props.gameState ? (
        <FarmScreen state={props.gameState} />
      ) : (
        <p data-testid="farm-loading">正在准备菜园…</p>
      );

    case "nightSettlement":
      return props.gameState ? (
        <NightSettlementScreen
          state={props.gameState}
          onSettleSleep={props.onFinishSleep ?? (() => undefined)}
          onResolveDailyEvent={props.onResolveDailyEvent ?? (() => undefined)}
          onRecoverDailyEvent={props.onRecoverDailyEvent ?? (() => undefined)}
          onContinue={() => {
            // Minimal mode drops the post-night gap-shop page entirely.
            setMorningInitialPanel(props.presentationMode === "minimal" ? null : "gap-shop");
            setScreen("morningMenu");
          }}
        />
      ) : (
        <p data-testid="night-loading">正在完成每日结算…</p>
      );

    case "morningMenu":
      return props.gameState ? (
        <MorningMenuScreen
          state={props.gameState}
          lastSavedAt={props.lastSavedAt}
          onSaveSlot={props.onSaveSlot}
          onLoadSlot={props.onLoadSlot}
          onRefreshSlots={props.onRefreshSlots}
          saveSlots={props.saveSlots}
          onBuyCatalogItem={props.onBuyCatalogItem}
          onUseInventoryItem={props.onUseInventoryItem}
          onSetWakeMinute={props.onSetWakeMinute}
          onSetHomeLocation={props.onSetHomeLocation}
          onResetCommissions={props.onResetCommissions}
          onResetClothes={props.onResetClothes}
          onReleaseBug={props.onReleaseBug}
          onMaterializeBug={props.onMaterializeBug}
          onTogglePortraitKind={props.onTogglePortraitKind}
          onSetPortraitVariant={props.onSetPortraitVariant}
          onTogglePantyGapAuto={props.onTogglePantyGapAuto}
          onClaimPantyCollectionBonus={props.onClaimPantyCollectionBonus}
          onSellPantyDuplicates={props.onSellPantyDuplicates}
          onTriggerManualNarrative={props.onTriggerManualNarrative}
          initialPanel={morningInitialPanel}
          onOpenEyes={async () => {
            setMorningInitialPanel(null);
            await props.onOpenEyes?.();
            // Screen navigation preserves the scene store. Drop only the old
            // presentation shell; GameClient will open the current morning
            // dialogue/choice from its authoritative owner-aware queue.
            useSceneStore.getState().closeInteraction();
            setScreen("mainGame");
          }}
        />
      ) : (
        <p data-testid="morning-loading">正在准备起床前主菜单…</p>
      );

    case "developerTools":
      return null;

    default: {
      const _exhaustive: never = screen;
      void _exhaustive;
      return null;
    }
  }
}
