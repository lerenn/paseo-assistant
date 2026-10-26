import { useRpc } from "@getpaseo/plugin/client";
import type { PluginIconProps } from "@getpaseo/plugin";
import { useAgent } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { Animated, Easing } from "react-native";
import { currentRpc } from "../shared/rpc";
import { isBusyStatus } from "./busy";

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

/** A spinner, as the host shows for running agents. */
export function BusyIcon({ size, color }: PluginIconProps) {
  const turn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(turn, { toValue: 1, duration: 1000, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [turn]);
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <Icon name="LoaderCircle" size={size} color={color} />
    </Animated.View>
  );
}
