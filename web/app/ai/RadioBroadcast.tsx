import { useEffect, useMemo, useState } from "react";
import { createOpenAiCompatibleProvider } from "./provider.js";
import { buildAiRadioCompletion, cleanAiRadioScript } from "./radio-runtime.js";
import { useAiStore } from "./store.js";

export interface RadioBroadcastProps {
  rawBroadcast: string;
}

interface BroadcastFacts {
  weather: string | null;
  temperature: string | null;
  warning: string | null;
  tendency: string | null;
  extra: string[];
}

export function parseRadioBroadcast(rawBroadcast: string): BroadcastFacts {
  const lines = rawBroadcast.split("\n").map((line) => line.trim()).filter(Boolean);
  const facts = lines.filter((line) => !line.includes("天气播报"));
  const take = (matcher: RegExp) => facts.find((line) => matcher.test(line)) ?? null;
  const claimed = new Set<string>();
  const weather = take(/^现在.*天气/);
  const temperature = take(/^(气温|温度)/);
  const warning = take(/(气象警报|当前发布)/);
  const tendency = take(/^天候倾向/);
  for (const line of [weather, temperature, warning, tendency]) if (line) claimed.add(line);
  return { weather, temperature, warning, tendency, extra: facts.filter((line) => !claimed.has(line)) };
}

export default function RadioBroadcast({ rawBroadcast }: RadioBroadcastProps) {
  const settings = useAiStore((state) => state.settings);
  const [script, setScript] = useState("");
  const [status, setStatus] = useState<"tuning" | "ready" | "fallback">("tuning");
  const facts = useMemo(() => parseRadioBroadcast(rawBroadcast), [rawBroadcast]);

  useEffect(() => {
    if (!settings.enabled || !settings.radioEnabled || !settings.baseUrl.trim() || !settings.model.trim()) {
      setScript("短波信号稳定，以下为幻想乡气象台定时播报。");
      setStatus("fallback");
      return;
    }
    const controller = new AbortController();
    setScript("");
    setStatus("tuning");
    void createOpenAiCompatibleProvider(settings)
      .complete(buildAiRadioCompletion(rawBroadcast, settings), controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        const next = cleanAiRadioScript(response);
        setScript(next || "短波信号稳定，以下为幻想乡气象台定时播报。");
        setStatus(next ? "ready" : "fallback");
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setScript("短波信号稳定，以下为幻想乡气象台定时播报。");
        setStatus("fallback");
      });
    return () => controller.abort();
  }, [rawBroadcast, settings]);

  return (
    <section className="radio-broadcast" data-testid="radio-broadcast" aria-label="收音机天气播报">
      <div className="radio-broadcast__header">
        <span className="radio-broadcast__lamp" aria-hidden="true" />
        <span>幻想乡短波气象台</span>
        <span className="radio-broadcast__frequency">FM 96.4</span>
      </div>
      <div className="radio-broadcast__dial" aria-hidden="true">
        {Array.from({ length: 18 }, (_, index) => <i key={index} style={{ height: `${20 + (index % 5) * 12}%` }} />)}
      </div>
      <p className={`radio-broadcast__script radio-broadcast__script--${status}`}>
        {status === "tuning" ? "滋... 正在校准短波信号..." : script}
      </p>
      <div className="radio-broadcast__facts">
        {facts.weather && <p className="radio-broadcast__fact radio-broadcast__fact--weather">{facts.weather}</p>}
        {facts.temperature && <p className="radio-broadcast__fact radio-broadcast__fact--temperature">{facts.temperature}</p>}
        {facts.warning && <p className={`radio-broadcast__fact ${facts.warning.includes("没有") ? "radio-broadcast__fact--clear" : "radio-broadcast__fact--warning"}`}>{facts.warning}</p>}
        {facts.tendency && <p className="radio-broadcast__fact radio-broadcast__fact--tendency">{facts.tendency}</p>}
        {facts.extra.map((line) => <p className="radio-broadcast__fact radio-broadcast__fact--extra" key={line}>{line}</p>)}
      </div>
    </section>
  );
}
