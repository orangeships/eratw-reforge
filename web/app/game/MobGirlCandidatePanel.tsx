import { useLayoutEffect, useMemo, useState } from "react";
import { useAiStore } from "../ai/store.js";
import {
  fallbackMobGirlProfile,
  generateMobGirlProfile,
  type MobGirlVoiceProfile,
} from "../ai/mob-girl-profile.js";
import type { MobGirlCandidateProfile } from "../../../modernization/runtime/world/dynamic-characters.js";
import MobPortrait from "./MobPortrait.js";

export default function MobGirlCandidatePanel({
  profile,
  onLoadingChange,
}: {
  profile: MobGirlCandidateProfile;
  onLoadingChange?: (loading: boolean) => void;
}) {
  const settings = useAiStore((state) => state.settings);
  const profileKey = [
    profile.seed,
    profile.callName,
    profile.species,
    profile.region,
    profile.location,
    profile.encounterType,
    profile.stamina.value,
    profile.stamina.max,
    profile.will.value,
    profile.will.max,
    profile.favor,
    profile.trust,
    profile.firstTimeStatus,
    profile.firstTimeHistory,
    ...profile.abilities.map((item) => `${item.key}:${item.value}`),
  ].join("|");
  const fallback = useMemo(() => fallbackMobGirlProfile(profile), [profileKey]);
  const aiRequested = settings.enabled && Boolean(settings.baseUrl.trim()) && Boolean(settings.model.trim());
  const [voice, setVoice] = useState<MobGirlVoiceProfile | null>(() => aiRequested ? null : fallback);
  const [loading, setLoading] = useState(false);

  useLayoutEffect(() => {
    const controller = new AbortController();
    let timeout: number | undefined;
    if (!settings.enabled || !settings.baseUrl.trim() || !settings.model.trim()) {
      onLoadingChange?.(false);
      setVoice(fallback);
      setLoading(false);
      return () => controller.abort();
    }

    let disposed = false;
    onLoadingChange?.(true);
    setVoice(null);
    setLoading(true);
    timeout = window.setTimeout(() => {
      controller.abort("timeout");
      if (!disposed) {
        onLoadingChange?.(false);
        setVoice(fallback);
        setLoading(false);
      }
    }, settings.timeoutMs);
    void generateMobGirlProfile(profile, settings, controller.signal)
      .then((result) => {
        if (!disposed && !controller.signal.aborted) {
          onLoadingChange?.(false);
          setVoice(result);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!disposed) {
          onLoadingChange?.(false);
          setVoice(fallback);
          setLoading(false);
        }
      })
      .finally(() => {
        if (timeout !== undefined) window.clearTimeout(timeout);
      });
    return () => {
      disposed = true;
      if (timeout !== undefined) window.clearTimeout(timeout);
      controller.abort("candidate changed");
    };
  }, [fallback, onLoadingChange, profileKey, settings.enabled, settings.baseUrl, settings.model, settings.apiKey, settings.temperature, settings.maxTokens, settings.timeoutMs]);

  if (!voice) {
    return (
      <section className="mob-girl-profile mob-girl-profile--loading" data-testid="mob-girl-candidate-panel">
        <div className="mob-girl-profile__loading" role="status" aria-live="polite">
          <span>物色中</span><b aria-hidden="true">...</b>
        </div>
      </section>
    );
  }

  return (
    <section className="mob-girl-profile" data-testid="mob-girl-candidate-panel">
      <div className="mob-girl-profile__portrait-pane">
        {profile.portrait && (
          <MobPortrait
            className="mob-girl-profile__portrait"
            portrait={profile.portrait}
            alt={`${profile.callName}的动态画像`}
            testId="mob-girl-candidate-portrait"
          />
        )}
        <div className="mob-girl-profile__portrait-caption">
          <strong>{profile.callName}</strong>
          <span>{profile.species}</span>
        </div>
      </div>
      <div className="mob-girl-profile__details">
        <header className="mob-girl-profile__head">
          <div>
            <strong>{profile.callName}</strong>
            <span>{profile.species} · {profile.region}</span>
          </div>
          <em>{profile.encounterType}</em>
        </header>
        <div className="mob-girl-profile__facts">
          <span><b>相遇地点</b>{profile.location}</span>
          <span><b>接触方式</b>{profile.encounterType}</span>
          <span><b>体力</b>{profile.stamina.value}/{profile.stamina.max}</span>
          <span><b>气力</b>{profile.will.value}/{profile.will.max}</span>
          <span><b>好感</b>{profile.favor}</span>
          <span><b>信赖</b>{profile.trust}</span>
          <span>
            <b>第一次状态</b>
            {profile.firstTimeStatus ?? "未知"}
            {profile.firstTimeHistory ? ` · ${profile.firstTimeHistory}` : ""}
          </span>
        </div>
        <div className="mob-girl-profile__abilities">
          <b>能力倾向</b>
          {profile.abilities.map((item) => (
            <span key={item.key}>{item.key} Lv{item.value}</span>
          ))}
        </div>
        <small className="mob-girl-profile__encounter">
          在 {profile.region} 的 {profile.location} 与一位陌生女孩短暂相遇。
        </small>
        <div className="mob-girl-profile__voice">
          <div>
            <p className="mob-girl-profile__voice-line">{voice.selfIntro}</p>
          </div>
          <div>
            <b>亲密偏好</b>
            <p>{voice.preference}</p>
          </div>
        </div>
        <small className="mob-girl-profile__source" aria-live="polite">
          {loading ? "" : voice.source === "ai" ? "本次介绍由角色视角随机生成" : "本次介绍根据候选资料生成"}
        </small>
      </div>
    </section>
  );
}
