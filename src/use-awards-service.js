import { useCallback, useEffect, useRef, useState } from "react";
import { emptyGame } from "./awards-live-model.js";
const TOKEN = "guess-the-winner-guest-token-v3";
const DEVICE = "guess-the-winner-device-v3";
function token() {
  return localStorage.getItem(TOKEN) || "";
}
async function request(
  route,
  body,
  method = body ? "POST" : "GET",
  retry = false,
) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(`/api/awards/${route}`, {
        method,
        credentials: "same-origin",
        cache: "no-store",
        signal: AbortSignal.timeout(12000),
        headers: {
          "Content-Type": "application/json",
          "X-Awards-Request": "1",
          ...(token() ? { "X-Awards-Token": token() } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new Error("Game server is unavailable. Reconnect and try again.");
      }
      if (!response.ok) {
        const error = new Error(payload.error || "Request failed.");
        error.status = response.status;
        throw error;
      }
      return payload;
    } catch (error) {
      if (!retry || attempt >= 2 || (error.status && error.status < 500))
        throw error;
      await new Promise((r) =>
        setTimeout(r, 200 * 2 ** attempt + Math.random() * 150),
      );
    }
  }
}
export function useAwardsService(isGuest) {
  const [state, setState] = useState(emptyGame);
  const [authenticated, setAuthenticated] = useState(isGuest ? true : null);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  const fetching = useRef(false);
  const again = useRef(false);
  const apply = useCallback(
    (next) => setState((old) => (next.revision >= old.revision ? next : old)),
    [],
  );
  const refresh = useCallback(async () => {
    if (!isGuest && !authenticated) return;
    if (fetching.current) {
      again.current = true;
      return;
    }
    fetching.current = true;
    try {
      const next = await request(isGuest ? "state" : "host/state");
      if (active.current) {
        apply({...next,receivedAt:Date.now()});
        setConnected(true);
        setError("");
      }
    } catch (e) {
      if (active.current) {
        setConnected(false);
        setError(e.message);
        if (e.status === 401) {
          if (isGuest) {
            localStorage.removeItem(TOKEN);
            again.current = true;
          } else setAuthenticated(false);
        }
      }
    } finally {
      fetching.current = false;
      if (again.current && active.current) {
        again.current = false;
        void refresh();
      }
    }
  }, [authenticated, isGuest, apply]);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (!isGuest)
      request("session")
        .then((s) => setAuthenticated(s.authenticated))
        .catch((e) => {
          setError(e.message);
          setAuthenticated(false);
        });
  }, [isGuest]);
  useEffect(() => {
    if (!isGuest && !authenticated) return;
    void refresh();
    let debounce;
    const events = new EventSource("/api/awards/events");
    const updated = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => void refresh(), 80 + Math.random() * 180);
    };
    events.addEventListener("update", updated);
    events.onerror = () => {
      setConnected(false);
    };
    events.onopen = () => {
      void refresh();
    };
    const fallback = setInterval(
      () => void refresh(),
      12000 + Math.random() * 3000,
    );
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    window.addEventListener("online", focus);
    return () => {
      events.close();
      clearTimeout(debounce);
      clearInterval(fallback);
      window.removeEventListener("focus", focus);
      window.removeEventListener("online", focus);
    };
  }, [authenticated, isGuest, refresh]);
  async function login(password) {
    setBusy(true);
    try {
      await request("session", { password });
      setAuthenticated(true);
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function command(body) {
    setBusy(true);
    try {
      const next = await request("host/command", body);
      apply({...next,receivedAt:Date.now()});
      setError("");
      return next;
    } catch (e) {
      setError(e.message);
      await refresh();
      throw e;
    } finally {
      setBusy(false);
    }
  }
  async function join(name, tableNumber) {
    let deviceId = localStorage.getItem(DEVICE);
    if (!deviceId) {
      deviceId = crypto.randomUUID();
      localStorage.setItem(DEVICE, deviceId);
    }
    const result = await request("join", { deviceId, name, tableNumber }, "POST", true);
    localStorage.setItem(TOKEN, result.token);
    await refresh();
    return result.player;
  }
  async function prepareClear() {
    setBusy(true);
    try{const result=await request('host/clear/prepare',{confirmation:'CLEAR ALL'});setError('');return result;}
    catch(e){setError(e.message);throw e;}
    finally{setBusy(false);}
  }
  async function vote(categoryId, nomineeId, expectedVersion) {
    const result = await request(
      "drafts",
      {
        categoryId,
        nomineeId,
        expectedVersion,
        requestId: crypto.randomUUID(),
      },
      "POST",
      true,
    );
    await refresh();
    return result;
  }
  return {
    state,
    authenticated,
    error,
    connected,
    busy,
    login,
    command,
    prepareClear,
    join,
    vote,
    refresh,
  };
}
