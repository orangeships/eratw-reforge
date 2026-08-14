/**
 * 角色数值调试面板 — a lightweight creator/debug tool to nudge a chara's five
 * relationship stats (信頼度/好感度/親密/従順/欲望) at any 阶段, to check dialogue
 * / training reactions without playing there naturally.
 *
 * All state access goes through the store's `debug*` actions (the runtime
 * `kojo-probe` helper), so this file never touches the raw stat namespaces.
 */

import { useMemo, useState } from "react";
import { useGameStateStore } from "../state/game-state-store.js";
import {
  MASTER_DEBUG_ABILITY_FIELDS,
  type MasterDebugAbilityKey,
} from "../../../modernization/runtime/debug/kojo-probe.js";

export interface KojoDebugPopupProps {
  onClose: () => void;
}

const FIELDS = ["信頼度", "好感度", "親密", "従順", "欲望"] as const;

export default function KojoDebugPopup(props: KojoDebugPopupProps) {
  const state = useGameStateStore((s) => s.state);
  const readGates = useGameStateStore((s) => s.debugReadCharaGates);
  const patchChara = useGameStateStore((s) => s.debugPatchChara);
  const readMasterAbilities = useGameStateStore((s) => s.debugReadMasterAbilities);
  const patchMasterAbilities = useGameStateStore((s) => s.debugPatchMasterAbilities);

  // Roster: every instantiated chara (charaNum > 0), by name.
  const charas = useMemo(() => {
    if (!state) return [];
    return Object.values(state.charas)
      .filter((c) => c.charaNum > 0)
      .map((c) => ({ num: c.charaNum, name: c.callName ?? `角色${c.charaNum}` }))
      .sort((a, b) => a.num - b.num);
  }, [state]);

  const [chara, setChara] = useState<number>(() => charas[0]?.num ?? 1);

  // Live stats for the selected chara (re-read every render via the store).
  const gates = state ? readGates(chara) : { 信頼度: 0, 好感度: 0, 親密: 0, 従順: 0, 欲望: 0 };
  const masterAbilities = readMasterAbilities();

  return (
    <div className="kojo-debug__backdrop" role="dialog" aria-label="角色数值调试">
      <div className="kojo-debug">
        <div className="kojo-debug__head">
          <strong>🐛 角色数值调试</strong>
          <button type="button" onClick={props.onClose}>关闭</button>
        </div>

        <label className="kojo-debug__row">
          <span>角色</span>
          <select value={chara} onChange={(e) => setChara(Number(e.target.value))}>
            {charas.map((c) => (
              <option key={c.num} value={c.num}>{c.num} {c.name}</option>
            ))}
          </select>
        </label>

        <fieldset className="kojo-debug__gates">
          <legend>关系数值（改完立即生效）</legend>
          {FIELDS.map((k) => (
            <label key={k}>
              <span>{k}</span>
              <input
                type="number"
                value={gates[k]}
                onChange={(e) => patchChara(chara, { [k]: Number(e.target.value) })}
              />
            </label>
          ))}
        </fieldset>

        <fieldset className="kojo-debug__gates" data-testid="kojo-debug-master-abilities">
          <legend>主角能力/采集Lv（仅主角，0-5）</legend>
          {MASTER_DEBUG_ABILITY_FIELDS.map((field) => (
            <label key={field.id}>
              <span>{field.key}</span>
              <input
                type="number"
                min="0"
                max="5"
                step="1"
                data-testid={`kojo-debug-master-ability-${field.id}`}
                value={masterAbilities[field.key]}
                onChange={(e) => patchMasterAbilities({
                  [field.key]: Number(e.target.value),
                } as Partial<Record<MasterDebugAbilityKey, number>>)}
              />
            </label>
          ))}
        </fieldset>

        <p className="kojo-debug__hint">
          改动即时写入当前状态：关系数值只改所选角色；能力数值只改主角。
        </p>
      </div>
    </div>
  );
}
