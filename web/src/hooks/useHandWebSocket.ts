import { useCallback, useEffect, useRef } from "react";
import { assignHandsByCameraPosition } from "../lib/frameTransforms";
import { mapFrame } from "../lib/gestureMapper";
import type { FrameMessage } from "../protocol";
import { parseServerMessage } from "../protocol";
import { HAND_WS_URL } from "../handWsUrl";
import { useDjStore } from "../store/djStore";

/**
 * Connects to hand_service, feeds {@link mapFrame} into the DJ store.
 */
export function useHandWebSocket() {
  const setMapper = useDjStore((s) => s.setMapper);
  const requestTransportToggles = useDjStore((s) => s.requestTransportToggles);
  const setConnected = useDjStore((s) => s.setConnected);
  const setError = useDjStore((s) => s.setError);
  const setLastFrameRaw = useDjStore((s) => s.setLastFrameRaw);
  const swapHands = useDjStore((s) => s.swapHands);
  const deskLayoutSnapshot = useDjStore((s) => s.deskLayoutSnapshot);
  const mapperRef = useRef(useDjStore.getState().mapper);

  useEffect(() => {
    return useDjStore.subscribe((s) => {
      mapperRef.current = s.mapper;
    });
  }, []);

  const applyFrame = useCallback(
    (raw: FrameMessage) => {
      const st = useDjStore.getState();
      const forControls = assignHandsByCameraPosition(raw, st.swapHands);
      const spatialLayout = st.deskLayoutSnapshot;
      const next = mapFrame(forControls, mapperRef.current, undefined, spatialLayout, st.relativeLevelMode);
      mapperRef.current = next;
      setMapper(next);
      if (next.smooth.transportToggles.length > 0) {
        requestTransportToggles(next.smooth.transportToggles);
      }
    },
    [setMapper, requestTransportToggles],
  );

  useEffect(() => {
    const raw = useDjStore.getState().lastFrameRaw;
    if (!raw) return;
    applyFrame(raw);
  }, [swapHands, deskLayoutSnapshot, applyFrame]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let alive = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      ws = new WebSocket(HAND_WS_URL);
      ws.onopen = () => {
        if (!alive) return;
        setConnected(true);
        setError(null);
      };
      ws.onclose = () => {
        if (!alive) return;
        setConnected(false);
        setLastFrameRaw(null);
        retryTimer = setTimeout(connect, 1500);
      };
      ws.onerror = () => {
        setError("WebSocket error — is hand_service running?");
      };
      ws.onmessage = (ev) => {
        const msg = parseServerMessage(String(ev.data));
        if (!msg || msg.type !== "frame") return;
        setLastFrameRaw(msg);
        applyFrame(msg);
      };
    };

    connect();
    return () => {
      alive = false;
      if (retryTimer) clearTimeout(retryTimer);
      ws?.close();
    };
  }, [applyFrame, setConnected, setError, setLastFrameRaw]);
}
