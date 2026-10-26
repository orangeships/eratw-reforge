import { useEffect, useState } from "react";
import type { CommandGridAction } from "../CommandGrid.js";

/** A second input for the same enabled command buttons, never a resolver bypass. */
export default function AsciiCommandLine({ actions, onAction, disabled, context }: {
  actions: ReadonlyArray<CommandGridAction>;
  onAction: (commandNo: number) => void;
  disabled: boolean;
  context: string;
}) {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { setInput(""); setError(""); }, [context, disabled]);
  return (
    <form className="ascii-command-line" data-testid="ascii-command-line" onSubmit={(event) => {
      event.preventDefault();
      if (disabled) return;
      const command = /^\d+$/.test(input) ? actions.find((action) => action.commandNo === Number(input)) : undefined;
      if (!command?.usable) { setError(command?.reason ?? "请输入当前可用的指令编号。"); return; }
      setInput(""); setError("");
      onAction(command.commandNo);
    }}>
      <span className="ascii-command-line__hint">{error || "输入编号 · Enter 执行"}</span>
      <label>
        <span aria-hidden="true">&gt; </span>
        <input aria-label="指令编号" inputMode="numeric" autoComplete="off" maxLength={5} value={input} disabled={disabled} onChange={(event) => { setInput(event.target.value); setError(""); }} />
      </label>
      <button type="submit" disabled={disabled}>[执行]</button>
    </form>
  );
}
