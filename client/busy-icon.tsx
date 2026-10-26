import { useRpc } from "@getpaseo/plugin/client";
import type { PluginIconProps } from "@getpaseo/plugin";
import { useAgent } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { currentRpc } from "../shared/rpc";
import { isBusyStatus } from "./busy";
import { startSpinner } from "./spin";

const POLL_MS = 15_000;

/** The Assistant's status from the host's live agent state; the id comes from a cheap RPC that never creates the agent. */
export function useAssistantBusy(): boolean {
  const current = useRpc(currentRpc);
  const id = useQuery({ queryKey: ["assistant", "current"], queryFn: () => current({}), refetchInterval: POLL_MS }).data?.agentId ?? null;
  const status = useAgent(id ?? "", (agent) => agent.status);
  return id !== null && isBusyStatus(status);
}

export function IdleIcon({ size, color }: PluginIconProps) {
  return <Icon name="Sparkles" size={size} color={color} />;
}

/** A spinner while the Assistant works: a timer turns it in steps for as long as it is mounted, and the row swaps to the static icon on idle. */
export function BusyIcon({ size, color }: PluginIconProps) {
  const [angle, setAngle] = useState(0);
  useEffect(() => startSpinner(setAngle), []);
  return (
    <View style={{ transform: [{ rotate: `${angle}deg` }] }}>
      <Icon name="LoaderCircle" size={size} color={color} />
    </View>
  );
}
