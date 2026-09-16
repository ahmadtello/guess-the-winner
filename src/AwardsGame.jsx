import React, { useEffect, useState } from "react";
import {
  Trophy24Regular,
  Grid24Regular,
  People24Regular,
  Settings24Regular,
  Phone24Regular,
  ArrowRight24Regular,
  Checkmark24Regular,
  LockClosed24Regular,
  Play24Regular,
  ArrowDownload24Regular,
  Open24Regular,
  ChevronLeft20Regular,
  ChevronRight20Regular,
  ArrowReset24Regular,
} from "@fluentui/react-icons";
import {
  canPredict,
  standings,
  totals,
  getRounds,
} from "./awards-live-model.js";
import { useAwardsService } from "./use-awards-service.js";
import "./awards.css";
import Guest from "./AwardsGuest.jsx";
import { TEXT_FIELDS, TEXT_GROUPS, COLOR_FIELDS, PLACEHOLDERS, EMPTY_THEME, themeText, themeStyle, themeLogo } from "./awards-theme.js";
import AwardsHostControls from "./AwardsHostControls.jsx";
import "./awards-artwork.css";

const gameHostname = import.meta.env.VITE_GAME_HOSTNAME || "";
const onDomain = !!gameHostname && window.location.hostname === gameHostname;
const guestPath = onDomain ? "/" : "/awards/play";
const hostPath = onDomain ? "/host" : "/awards";
function Logo({ className = "" }) {
  return (
    <img
      className={`aw-logo ${className}`}
      src="/brand/logo.svg"
      alt="Guess the Winner"
    />
  );
}
function Mark({ nominee }) {
  return nominee.logo ? (
    <img
      className="aw-company-image"
      src={nominee.logo}
      alt={`${nominee.name} logo`}
    />
  ) : (
    <span
      className={`aw-wordmark aw-mark-${nominee.id}`}
      style={{ color: nominee.color }}
    >
      {nominee.mark}
    </span>
  );
}
function Badge({ status }) {
  return (
    <span className={`aw-status aw-status-${status}`}>
      {
        {
          open: "Predictions open",
          locked: "Locked",
          revealed: "Category closed",
          waiting: "Upcoming",
        }[status]
      }
    </span>
  );
}
function Action({ children, secondary, ...props }) {
  return (
    <button
      className={`aw-button ${secondary ? "aw-secondary" : ""}`}
      {...props}
    >
      {children}
    </button>
  );
}

export default function AwardsGame() {
  const isGuest = onDomain
    ? window.location.pathname !== "/host"
    : window.location.pathname.startsWith("/awards/play");
  const api = useAwardsService(isGuest);
  const { state, error } = api;
  const [view, setView] = useState("control");
  const [selected, setSelected] = useState(state.active);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [clearStep,setClearStep]=useState(0);
  const [clearChallenge,setClearChallenge]=useState('');
  const [clearText,setClearText]=useState('');
  const [hostPassword, setHostPassword] = useState("");
  useEffect(()=>{if(view!=='settings')setMessage('');},[view]);
  useEffect(() => {
    document.title = "Guess the Winner";
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", "#075337");
  }, []);
  const category =
    state.categories.find((c) => c.id === selected) || state.categories[0];
  const rounds=getRounds(state.categories);
  const roundIndex=rounds.findIndex(r=>r.name===category.group);
  const round=rounds[roundIndex];
  const counts = totals(state, category);
  const responses = counts.reduce((s, n) => s + n.votes, 0);
  const rankings = standings(state);
  const [themeDraft, setThemeDraft] = useState(null);
  const theme = themeDraft ?? state.theme ?? EMPTY_THEME;
  const themeDirty = themeDraft !== null;
  const setThemeText = (key, value) => setThemeDraft({ ...theme, texts: { ...theme.texts, [key]: value } });
  const setThemeColor = (key, value) => setThemeDraft({ ...theme, colors: { ...theme.colors, [key]: value } });
  async function saveTheme() {
    try {
      await api.command({ type: "theme", patch: { texts: theme.texts || {}, colors: theme.colors || {}, logo: theme.logo || "" } });
      setThemeDraft(null);
      setMessage("Text and appearance saved. Guests see the changes immediately.");
    } catch {}
  }
  async function resetTheme() {
    try {
      await api.command({ type: "theme-reset" });
      setThemeDraft(null);
      setMessage("Text and appearance restored to the standard wording and colours.");
    } catch {}
  }
  function uploadThemeLogo(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 150000) {
      setMessage("Choose a PNG, JPG or WebP logo smaller than 150 KB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setThemeDraft({ ...theme, logo: reader.result });
    reader.readAsDataURL(file);
  }
  const leaders = rankings.filter((p) => p.rank === 1);
  const [drawing, setDrawing] = useState(false);
  const [spinName, setSpinName] = useState("");
  const raffleStale = !!state.raffle && (leaders.length !== state.raffle.candidates.length || leaders.some((p) => !state.raffle.candidates.includes(p.id)));
  async function drawRaffle() {
    if (drawing) return;
    setDrawing(true);
    let i = 0;
    const names = leaders.map((p) => p.name);
    setSpinName(names[0] || "");
    const spin = setInterval(() => setSpinName(names[++i % names.length]), 90);
    const started = Date.now();
    try { await api.command({ type: "raffle" }); } catch {}
    await new Promise((r) => setTimeout(r, Math.max(0, 2600 - (Date.now() - started))));
    clearInterval(spin);
    setSpinName("");
    setDrawing(false);
  }
  const scored = state.categories.filter((c) => c.status === "locked").length;
  function run(body) {
    void api.command(body).catch(() => {});
  }
  function cancelClear(){setClearStep(0);setClearChallenge('');setClearText('');}
  async function firstClearConfirmation(){
    try{const result=await api.prepareClear();setClearChallenge(result.challenge);setClearStep(2);setClearText('');}catch{}
  }
  async function finalClearConfirmation(){
    if(clearText.trim()!=='CLEAR ALL')return;
    try{await api.command({type:'clear-all',challenge:clearChallenge,confirmation:clearText.trim()});cancelClear();setSelected(state.categories[0].id);setMessage('All answers and participants cleared. Guests must join again.');}catch{}
  }
  function changeCategory(fn) {
    const changed = fn(category);
    if (changed.status === "locked")
      run({ type: "lock", categoryId: category.id });
    else
      run({
        type: "edit",
        categoryId: category.id,
        patch: { name: changed.name, nominees: changed.nominees },
      });
  }
  function openCategory() {
    run({ type: "open", categoryId: category.id });
  }
  function csvExport() {
    const q = (v) =>
      `"${String(v)
        .replace(/^[=+@\-]/, "'$&")
        .replaceAll('"', '""')}"`;
    const rows = [
      [
        "Participant",
        "Table number",
        ...rounds.map(r=>r.name+' score'),
        "Correct predictions",
        "Answered",
        ...state.categories.map((c) => c.name),
      ],
      ...rankings.map((p) => [
        p.name,
        p.tableNumber || "",
        ...rounds.map(r=>p.roundScores?.[r.name]||0),
        p.score,
        p.answered,
        ...state.categories.map(
          (c) => c.nominees.find((n) => n.id === p.picks[c.id])?.name || "",
        ),
      ]),
    ];
    const url = URL.createObjectURL(
      new Blob(
        ["\uFEFF" + rows.map((row) => row.map(q).join(",")).join("\r\n")],
        { type: "text/csv;charset=utf-8" },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "guess-the-winner-results.csv";
    a.click();
    URL.revokeObjectURL(url);
    setMessage("Private results exported.");
  }
  async function upload(e, nomineeId) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 500000
    ) {
      setMessage("Choose a PNG, JPG or WebP logo smaller than 500 KB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () =>
      changeCategory((c) => ({
        ...c,
        nominees: c.nominees.map((n) =>
          n.id === nomineeId ? { ...n, logo: reader.result } : n,
        ),
      }));
    reader.readAsDataURL(file);
  }
  if (isGuest)
    return (
      <main className="aw-app aw-standalone" style={themeStyle(state.theme)}>
        <div className="aw-preview-ribbon">
          {api.connected
            ? themeText(state.theme, "connected")
            : themeText(state.theme, "reconnecting")}{" "}
        </div>
        {error && <p role="alert">{error}</p>}
        <Guest state={{ ...state, serverConnected: api.connected }} api={api} />
      </main>
    );
  if (!api.authenticated)
    return (
      <main className="aw-app aw-host-login">
        <section>
          <Logo />
          <h1>Host sign in</h1>
          <p>
            Manage questions and view private
            results.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void api.login(hostPassword);
            }}
          >
            <label>
              Host password
              <input
                type="password"
                value={hostPassword}
                onChange={(e) => setHostPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            <Action disabled={api.busy || api.authenticated === null}>
              {api.busy ? "Signing in…" : "Sign in"}
            </Action>
          </form>
          <p role="alert">{error}</p>
          {import.meta.env.DEV && <small>Local access details are in .private/host-access.txt</small>}
          <a href={guestPath}>Open guest game</a>
        </section>
      </main>
    );
  return (
    <main className="aw-app">
      <div className="aw-preview-ribbon">
        <span>
          <b>{api.connected ? "GAME SERVER CONNECTED" : "RECONNECTING"}</b> · {rounds.length} rounds · {state.categories.length} questions
        </span>
        <span>{window.location.origin}</span>
      </div>
      <div className="aw-host-shell">
        <aside className="aw-sidebar">
          <Logo />
          <div className="aw-workspace-label">Awards game studio</div>
          <nav aria-label="Host navigation">
            {[
              ["control", Grid24Regular, "Game control"],
              ["categories", Settings24Regular, "Categories & nominees"],
              ["results", Trophy24Regular, "Private results"],
              ["participants", People24Regular, "Participants"],
              ["join", Phone24Regular, "QR code"],
              ["settings", Settings24Regular, "Game settings"],
            ].map(([id, Icon, label]) => (
              <button
                key={id}
                className={view === id ? "active" : ""}
                aria-current={view === id ? "page" : undefined}
                onClick={() => setView(id)}
              >
                <Icon />
                {label}
              </button>
            ))}
          </nav>
          <div className="aw-sidebar-bottom">
            <span>GUESS THE WINNER</span>
            <p>
              One celebration.
              <br />
              Everyone can play.
            </p>
            <a href={guestPath} target="_blank" rel="noreferrer">
              Open guest preview <Open24Regular />
            </a>
          </div>
        </aside>
        <div className="aw-host-content">
          <header className="aw-host-header">
            <div>
              <span>Guess the Winner / Host studio</span>
              <h1>
                {
                  {
                    control: "Game control",
                    categories: "Categories & nominees",
                    results: "Private results",
                    participants: "Participants",
                    join: "QR code",
                    settings: "Game settings",
                  }[view]
                }
              </h1>
            </div>
            <a
              className="aw-button aw-secondary"
              href={guestPath}
              target="_blank"
              rel="noreferrer"
            >
              <Phone24Regular /> Guest preview <Open24Regular />
            </a>
          </header>
          <div className="aw-demo-message" role="status">
            {error ||
              message ||
              "You control each question. Start it, let guests choose, then end it to submit their answers."}
          </div>
          <div className="aw-host-body">
            {view === "control" && <AwardsHostControls state={state} api={api} category={category} onSelect={setSelected}/> }
            {view === "results" && (
              <section className="aw-wide-panel">
                <div className="aw-panel-heading">
                  <div>
                    <h2>
                      {state.finalPublished
                        ? "Final game results"
                        : "Every correct guess counts."}
                    </h2>
                    <p>
                      {scored} of {state.categories.length} questions scored across {rounds.length} rounds.
                      Joint award winners both earn one point.
                    </p>
                  </div>
                  <Action secondary onClick={csvExport}>
                    <ArrowDownload24Regular /> Export results
                  </Action>
                </div>
                <div className="aw-leader-banner">
                  <Trophy24Regular />
                  <div>
                    <b>
                      {state.finalPublished
                        ? "Game complete"
                        : "Private scores update as each category closes."}
                    </b>
                    <p>
                      {state.finalPublished
                        ? leaders.length === 1
                          ? `Winner: ${leaders[0].name} · Table ${leaders[0].tableNumber || "—"} · ${leaders[0].score} correct predictions.`
                          : leaders.length
                            ? `${leaders.length} players share first place with ${leaders[0].score} correct predictions: ${leaders.map((p) => `${p.name} (Table ${p.tableNumber || "—"})`).join(", ")}.${state.raffle && !raffleStale ? ` Raffle winner: ${state.raffle.name} · Table ${state.raffle.tableNumber || "—"}.` : ""}`
                            : "No participants scored."
                        : "Close every category, then finalize the private game results."}
                    </p>
                  </div>
                  <Action
                    disabled={
                      scored !== state.categories.length ||
                      state.finalPublished
                    }
                    onClick={() => run({ type: "finalize" })}
                  >
                    Finalize game results
                  </Action>
                </div>
                {(leaders.length > 1 || state.raffle) && (
                  <div className={`aw-raffle ${drawing ? "aw-raffle-drawing" : ""}`} role="status" aria-live="polite">
                    <div className="aw-raffle-text">
                      <b>Tie-break raffle</b>
                      <p>
                        {leaders.length > 1
                          ? `${leaders.length} players share first place with ${leaders[0].score} correct guesses. Draw one winner at random.`
                          : "First place is no longer tied. The last draw is kept for reference."}
                      </p>
                      {drawing ? (
                        <div className="aw-raffle-spin">{spinName}</div>
                      ) : state.raffle ? (
                        <div className="aw-raffle-winner">
                          <Trophy24Regular />
                          <div>
                            <span>Raffle winner</span>
                            <strong>{state.raffle.name}</strong>
                            <small>Table {state.raffle.tableNumber || "—"} · drawn {new Date(state.raffle.drawnAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}{state.raffle.draws > 1 ? ` · draw ${state.raffle.draws}` : ""}</small>
                            {raffleStale && <em>The tie has changed since this draw. Draw again to be sure.</em>}
                          </div>
                        </div>
                      ) : null}
                    </div>
                    {leaders.length > 1 && (
                      <Action secondary={!!state.raffle && !raffleStale} disabled={drawing || scored !== state.categories.length} onClick={drawRaffle}>
                        {drawing ? "Drawing…" : state.raffle ? "Draw again" : "Draw the winner"}
                      </Action>
                    )}
                  </div>
                )}
                <div className="aw-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Participant</th>
                        <th>Table number</th>
                        <th>Correct guesses</th>
                        {rounds.map((r,i)=><th key={r.id}>Round {i+1}</th>)}
                        <th>Categories answered</th>
                        <th>Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...rankings]
                        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
                        .slice(0, 50)
                        .map((p) => (
                          <tr key={p.id}>
                            <td>
                              <b>{p.name}</b>
                            </td>
                            <td>{p.tableNumber || "—"}</td>
                            <td>
                              {p.score} / {scored}
                            </td>
                            {rounds.map(r=><td key={r.id}>{p.roundScores?.[r.name]||0} / {r.questions.length}</td>)}
                            <td>
                              {p.answered} / {state.categories.length}
                            </td>
                            <td>{"Registered guest"}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                <p className="aw-muted">
                  Showing 50 participants alphabetically from {rankings.length}.
                  Export includes everyone.
                </p>
              </section>
            )}
            {view === 'join' && <section className="aw-wide-panel aw-qr-panel">
              <Logo/><h2>Scan to play</h2><p>Guess the Winner</p>
              <img className="aw-join-qr" src="/awards/join-qr.png" alt={`QR code to open ${window.location.origin}`} width="320" height="320"/>
              <a href={window.location.origin} target="_blank" rel="noreferrer">{window.location.origin.replace(/^https?:\/\//, '')}</a>
              <p>Enter the table representative’s name and table number to join.</p>
              <a className="aw-button" href="/awards/join-qr.png" download="Guess-the-Winner-QR.png">Download QR code</a>
              <a className="aw-button aw-secondary" href="/awards/join-screen.html" target="_blank" rel="noreferrer">Open screen for the venue</a>
            </section>}
            {view === "participants" && (
              <section className="aw-wide-panel">
                <div className="aw-panel-heading">
                  <div>
                    <h2>{state.playerCount} participants</h2>
                    <p>
                      Registered participants and their submitted predictions.
                    </p>
                  </div>
                  <Action secondary onClick={csvExport}>
                    <ArrowDownload24Regular /> Export
                  </Action>
                </div>
                <label className="aw-search">
                  Find a participant
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by name"
                  />
                </label>
                <div className="aw-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Participant</th>
                        <th>Predictions</th>
                        <th>Table number</th>
                        <th>Correct guesses</th>
                        <th>Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rankings
                        .filter((p) =>
                          p.name.toLowerCase().includes(search.toLowerCase()),
                        )
                        .slice(0, 50)
                        .map((p) => (
                          <tr key={p.id}>
                            <td>
                              <b>{p.name}</b>
                            </td>
                            <td>{p.answered}</td>
                            <td>{p.tableNumber || "—"}</td>
                            <td>{p.score}</td>
                            <td>{"Registered guest"}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                {!rankings.some((p) =>
                  p.name.toLowerCase().includes(search.toLowerCase()),
                ) && <p>No participants match “{search}”.</p>}
                <p className="aw-muted">
                  Up to 50 matching participants shown. Export includes all
                  participants.
                </p>
              </section>
            )}
            {view === "categories" && (
              <section className="aw-wide-panel">
                <div className="aw-panel-heading">
                  <div>
                    <h2>Make every nominee feel at home.</h2>
                    <p>
                      Imported from your awards shortlist. All {state.categories.reduce((n, c) => n + c.nominees.length, 0)} nominations across {state.categories.length} categories are
                      matched to supplied logos.
                    </p>
                  </div>
                </div>
                <div className="aw-editor-layout">
                  <nav className="aw-category-nav">
                    {state.categories.map((c, i) => (
                      <button
                        className={selected === c.id ? "selected" : ""}
                        aria-current={selected === c.id ? "page" : undefined}
                        onClick={() => setSelected(c.id)}
                        key={c.id}
                      >
                        <span>{i + 1}</span>
                        <b>{c.name}</b>
                      </button>
                    ))}
                  </nav>
                  <div className="aw-editor">
                    <label>
                      Category name
                      <input
                        maxLength={100}
                        value={category.name}
                        onChange={(e) =>
                          changeCategory((c) => ({
                            ...c,
                            name: e.target.value,
                          }))
                        }
                      />
                    </label>
                    <p>
                      Upload a logo for each company (PNG, JPG or WebP, up to
                      500 KB). Tick the correct answer for each category; ticks stay private to the host and decide the scores. More than one company can be correct.
                    </p>
                    {category.nominees.map((n) => (
                      <div className={`aw-edit-nominee ${state.correctAnswers?.[category.id]?.includes(n.id) ? "aw-correct" : ""}`} key={n.id}>
                        <div className="aw-result-mark">
                          <Mark nominee={n} />
                        </div>
                        <button
                          type="button"
                          className={`aw-answer-toggle ${state.correctAnswers?.[category.id]?.includes(n.id) ? "aw-correct" : ""}`}
                          aria-pressed={!!state.correctAnswers?.[category.id]?.includes(n.id)}
                          disabled={api.busy || state.finalPublished}
                          onClick={() => run({ type: "answer", categoryId: category.id, nomineeId: n.id, correct: !state.correctAnswers?.[category.id]?.includes(n.id) })}
                        >
                          <Checkmark24Regular /> {state.correctAnswers?.[category.id]?.includes(n.id) ? "Correct answer" : "Mark as correct"}
                        </button>
                        <label>
                          Company name
                          <input
                            maxLength={100}
                            value={n.name}
                            onChange={(e) =>
                              changeCategory((c) => ({
                                ...c,
                                nominees: c.nominees.map((item) =>
                                  item.id === n.id
                                    ? { ...item, name: e.target.value }
                                    : item,
                                ),
                              }))
                            }
                          />
                        </label>
                        <label className="aw-upload">
                          Upload logo
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            onChange={(e) => upload(e, n.id)}
                          />
                        </label>
                      </div>
                    ))}
                    <small>
                      Edits save to the game server and appear for all guests.
                    </small>
                  </div>
                </div>
              </section>
            )}
            {view === "settings" && (
              <section className="aw-wide-panel aw-settings">
                <h2>Your game, your format.</h2>
                <p>
                  Private results combine correct predictions across every category.
                </p>
                <div className="aw-setting-row"><span><b>Host-controlled questions</b><small>Choose a question and press Start. Press End question to submit saved selections. Guests wait until you start another question.</small></span></div>
                <div className="aw-setting-row">
                  <span>
                    <b>Scoring</b>
                    <small>
                      1 point per correct prediction · no speed bonus
                    </small>
                  </span>
                  <Trophy24Regular />
                </div>
                <div className="aw-setting-row">
                  <span>
                    <b>Tied scores</b>
                    <small>
                      Shared rank. If first place is tied, use the raffle draw on Private results to pick one winner at random.
                    </small>
                  </span>
                </div>
                <div className="aw-setting-row">
                  <span>
                    <b>Public address</b>
                    <small>{window.location.origin}</small>
                  </span>
                  <span className="aw-status">{onDomain?'Live':'Local preview'}</span>
                </div>
                <div className="aw-setting-row">
                  <span>
                    <b>Launch readiness</b>
                    <small>
                      Shared database and protected host access are connected.
                      The portal is deployed. Check the venue Wi-Fi before the event.
                    </small>
                  </span>
                </div>
                <div className="aw-theme">
                  <h3>Text and appearance</h3>
                  <p>
                    Change every sentence guests see and the colours of the guest page. Leave a field empty to keep the standard wording shown in grey.
                    Placeholders are filled in automatically: {PLACEHOLDERS.join(", ")}.
                  </p>
                  <div className="aw-theme-layout">
                    <div className="aw-theme-fields">
                      {TEXT_GROUPS.map((group) => (
                        <fieldset key={group}>
                          <legend>{group}</legend>
                          {TEXT_FIELDS.filter((f) => f.group === group).map((f) => (
                            <label key={f.key}>
                              {f.label}
                              {f.multiline ? (
                                <textarea rows={2} value={theme.texts?.[f.key] ?? ""} placeholder={f.default} maxLength={600} onChange={(e) => setThemeText(f.key, e.target.value)} />
                              ) : (
                                <input value={theme.texts?.[f.key] ?? ""} placeholder={f.default} maxLength={600} onChange={(e) => setThemeText(f.key, e.target.value)} />
                              )}
                            </label>
                          ))}
                        </fieldset>
                      ))}
                      <fieldset>
                        <legend>Colours</legend>
                        <div className="aw-theme-colors">
                          {COLOR_FIELDS.map((c) => (
                            <label key={c.key}>
                              <input type="color" value={theme.colors?.[c.key] || c.default} onChange={(e) => setThemeColor(c.key, e.target.value)} />
                              <span>{c.label}</span>
                              <small>{theme.colors?.[c.key] || c.default}{theme.colors?.[c.key] && theme.colors[c.key] !== c.default ? <button type="button" className="aw-text-button" onClick={() => setThemeColor(c.key, "")}>Reset</button> : null}</small>
                            </label>
                          ))}
                        </div>
                      </fieldset>
                      <fieldset>
                        <legend>Banner logo</legend>
                        <div className="aw-theme-logo">
                          <img src={themeLogo(theme)} alt="" />
                          <label className="aw-upload">
                            Upload logo
                            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadThemeLogo} />
                          </label>
                          {theme.logo ? <Action secondary onClick={() => setThemeDraft({ ...theme, logo: "" })}>Use standard logo</Action> : null}
                        </div>
                        <small>PNG, JPG or WebP up to 150 KB. Shown at the top of every guest screen.</small>
                      </fieldset>
                    </div>
                    <div className="aw-theme-preview">
                      <b>Live preview</b>
                      <Guest state={{ ...state, theme, finalPublished: false, serverConnected: true }} api={api} embedded />
                    </div>
                  </div>
                  <div className="aw-theme-actions">
                    <Action disabled={!themeDirty || api.busy} onClick={saveTheme}>Save text and appearance</Action>
                    <Action secondary disabled={!themeDirty} onClick={() => setThemeDraft(null)}>Discard changes</Action>
                    <Action secondary disabled={api.busy} onClick={resetTheme}>Restore standard wording and colours</Action>
                  </div>
                </div>
                <div className="aw-reset">
                  <h3>Clear all answers and participants</h3>
                  <p>
                    Delete all participants, answers, saved selections and private scores. All three rounds return to waiting. Your questions, nominees and logos are kept. Questions stay open until the host ends them.
                  </p>
                  {clearStep===0&&<Action secondary onClick={()=>setClearStep(1)}><ArrowReset24Regular/>Clear all answers and participants</Action>}
                  {clearStep===1&&<section className="aw-clear-confirm" aria-label="First clear confirmation">
                    <h4>Confirmation 1 of 2</h4>
                    <p>You are about to remove {state.playerCount} participants and every answer and saved selection. Everyone will need to join again.</p>
                    <div className="aw-clear-actions"><Action disabled={api.busy} onClick={firstClearConfirmation}>Continue to second confirmation</Action><Action secondary disabled={api.busy} onClick={cancelClear}>Cancel</Action></div>
                  </section>}
                  {clearStep===2&&<section className="aw-clear-confirm" aria-label="Final clear confirmation">
                    <h4>Confirmation 2 of 2</h4>
                    <p>This permanently removes all {state.playerCount} participants and their answers from the game.</p>
                    <label>Type CLEAR ALL to confirm<input value={clearText} onChange={e=>setClearText(e.target.value)} autoComplete="off" autoFocus spellCheck={false}/></label>
                    <div className="aw-clear-actions"><Action disabled={api.busy||clearText.trim()!=='CLEAR ALL'} onClick={finalClearConfirmation}>{api.busy?'Clearing…':'Clear everything permanently'}</Action><Action secondary disabled={api.busy} onClick={cancelClear}>Cancel</Action></div>
                  </section>}
                </div>
              </section>
            )}
          </div>
          <footer className="aw-host-footer">
            <span>Guess the Winner</span>
            <span>
              {api.connected
                ? "Connected · results visible to hosts only"
                : "Reconnecting to game server"}
            </span>
          </footer>
        </div>
      </div>
    </main>
  );
}
