import express from "express";
import helmet from "helmet";
import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  randomInt,
  randomUUID,
  createHash,
  createHmac,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha = (value) => createHash("sha256").update(value).digest("hex");
class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (condition, status, message) => {
  if (condition) throw new RequestError(status, message);
};

export function createAwardsService(options = {}) {
  const storage = options.storage || process.env.AWARDS_STORAGE_DIR || path.join(root, ".private");
  mkdirSync(storage, { recursive: true });
  const production = process.env.NODE_ENV === "production";
  const file = (name) => path.join(storage, name);
  const persistentSecret = () => {
    if (!existsSync(file("awards-secret")))
      writeFileSync(file("awards-secret"), randomBytes(48).toString("hex"), {
        mode: 0o600,
      });
    return readFileSync(file("awards-secret"), "utf8").trim();
  };
  const secret =
    options.secret || process.env.AWARDS_SESSION_SECRET || persistentSecret();
  let adminPassword =
    options.adminPassword || process.env.AWARDS_ADMIN_PASSWORD;
  if (!adminPassword && !production) {
    if (!existsSync(file("host-access.txt")))
      writeFileSync(
        file("host-access.txt"),
        `Guess the Winner local host password\n${randomBytes(18).toString("base64url")}\n\nHost: http://localhost:5173/awards\n`,
        { mode: 0o600 },
      );
    adminPassword = readFileSync(file("host-access.txt"), "utf8").split(
      "\n",
    )[1];
  }
  if (!adminPassword || adminPassword.length < 16)
    throw new Error("Set AWARDS_ADMIN_PASSWORD to at least 16 characters.");
  const passwordSalt = randomBytes(16);
  const passwordHash = scryptSync(adminPassword, passwordSalt, 32);
  const shortlist =
    options.shortlist ||
    JSON.parse(
      readFileSync(path.join(root, "src/awards-shortlist.json"), "utf8"),
    );
  const key =
    options.answerKey ||
    JSON.parse(
      readFileSync(
        process.env.AWARDS_ANSWER_KEY_FILE || file("awards-answer-key.json"),
        "utf8",
      ),
    );
  if (key.dataset !== shortlist.dataset)
    throw new Error("Answer key and shortlist dataset do not match.");
  for (const c of shortlist.categories)
    if (
      !key.winners[c.id]?.length ||
      key.winners[c.id].some((id) => !c.nominees.some((n) => n.id === id))
    )
      throw new Error(`Invalid answer key for ${c.id}`);
  const db = new DatabaseSync(options.database || file("awards.sqlite"));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS config (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, device TEXT UNIQUE NOT NULL, token_hash TEXT UNIQUE NOT NULL, name TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS votes (player_id TEXT NOT NULL REFERENCES players(id), category_id TEXT NOT NULL, nominee_id TEXT NOT NULL, version INTEGER NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY(player_id, category_id));
    CREATE TABLE IF NOT EXISTS receipts (player_id TEXT NOT NULL REFERENCES players(id), request_id TEXT NOT NULL, payload_hash TEXT NOT NULL, PRIMARY KEY(player_id, request_id));
    CREATE TABLE IF NOT EXISTS host_sessions (token_hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);`);
  const seed = () => ({
    version: 3,
    dataset: shortlist.dataset,
    mode: "live",
    questionControl: "manual",
    screen: "question",
    active: shortlist.categories[0].id,
    finalPublished: false,
    revision: 0,
    answers: structuredClone(key.winners),
    theme: { texts: {}, colors: {}, logo: "" },
    categories: shortlist.categories.map((c, i) => ({
      ...structuredClone(c),
      status: "waiting",
      durationSeconds: null,
      startedAt: null,
      endsAt: null,
      winner: null,
      winners: [],
    })),
  });
  const configGet = db.prepare("SELECT value FROM config WHERE id=1");
  const configSave = db.prepare(
    "INSERT INTO config(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
  );
  if (!configGet.get()) configSave.run(JSON.stringify(seed()));
  let game = JSON.parse(configGet.get().value);
  let controlMigration=game.questionControl!=='manual';
  game.questionControl='manual';
  for(const c of game.categories) {
    if(c.durationSeconds!==null||c.endsAt!==null||c.remainingMs!==null)controlMigration=true;
    c.durationSeconds=null;c.endsAt=null;c.remainingMs=null;
    if(c.status==='paused'){c.status='waiting';controlMigration=true;}
    if(c.status==='revealed'){c.status='locked';controlMigration=true;}
    if(c.winner||c.winners?.length){c.winner=null;c.winners=[];controlMigration=true;}
  }
  if(game.mode!=='live'){game.mode='live';controlMigration=true;}
  if(!game.answers||typeof game.answers!=='object'){game.answers=structuredClone(key.winners);controlMigration=true;}
  if(!game.theme||typeof game.theme!=='object'){game.theme={texts:{},colors:{},logo:''};controlMigration=true;}
  if(controlMigration){game.revision++;configSave.run(JSON.stringify(game));}
  if (game.dataset !== shortlist.dataset)
    throw new Error(
      "Database belongs to a different shortlist; migrate it explicitly.",
    );
  if (!db.prepare('PRAGMA table_info(players)').all().some(c => c.name === 'table_number'))
    db.exec("ALTER TABLE players ADD COLUMN table_number TEXT NOT NULL DEFAULT ''");
  const playerByDevice = db.prepare("SELECT * FROM players WHERE device=?");
  const playerByToken = db.prepare("SELECT * FROM players WHERE token_hash=?");
  const playerInsert = db.prepare(
    "INSERT INTO players(id,device,token_hash,name,created,table_number) VALUES(?,?,?,?,?,?)",
  );
  const countPlayers = db.prepare("SELECT COUNT(*) AS count FROM players");
  const allPlayers = db.prepare(
    "SELECT id,name,table_number AS tableNumber FROM players ORDER BY created,id",
  );
  const allVotes = db.prepare(
    "SELECT player_id,category_id,nominee_id,version FROM votes",
  );
  const receiptGet = db.prepare(
    "SELECT payload_hash FROM receipts WHERE player_id=? AND request_id=?",
  );
  const receiptSave = db.prepare("INSERT INTO receipts VALUES(?,?,?)");
  const voteGet = db.prepare(
    "SELECT version FROM votes WHERE player_id=? AND category_id=?",
  );
  const voteSave = db.prepare(
    "INSERT INTO votes VALUES(?,?,?,?,?) ON CONFLICT(player_id,category_id) DO UPDATE SET nominee_id=excluded.nominee_id, version=excluded.version, updated=excluded.updated",
  );
  db.exec('CREATE TABLE IF NOT EXISTS drafts (player_id TEXT NOT NULL REFERENCES players(id), category_id TEXT NOT NULL, nominee_id TEXT NOT NULL, version INTEGER NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY(player_id,category_id))');
  const allDrafts=db.prepare('SELECT * FROM drafts');
  const draftGet=db.prepare('SELECT version FROM drafts WHERE player_id=? AND category_id=?');
  const draftSave=db.prepare('INSERT INTO drafts VALUES(?,?,?,?,?) ON CONFLICT(player_id,category_id) DO UPDATE SET nominee_id=excluded.nominee_id,version=excluded.version,updated=excluded.updated');
  const promoteDrafts=db.prepare('INSERT INTO votes SELECT * FROM drafts WHERE category_id=? ON CONFLICT(player_id,category_id) DO UPDATE SET nominee_id=excluded.nominee_id,version=excluded.version,updated=excluded.updated');
  const clearDrafts=db.prepare('DELETE FROM drafts WHERE category_id=?');
  function finishCategory(c) {
    promoteDrafts.run(c.id);clearDrafts.run(c.id);
    c.status='locked';c.remainingMs=null;
    c.closedAt=Date.now();
  }
  function startCategory(c) {
    c.durationSeconds=null;c.status='open';c.startedAt=Date.now();c.endsAt=null;c.closedAt=null;c.remainingMs=null;
  }
  const sessionGet = db.prepare(
    "SELECT expires FROM host_sessions WHERE token_hash=?",
  );
  const sessionSave = db.prepare("INSERT INTO host_sessions VALUES(?,?)");
  const sessionDelete = db.prepare(
    "DELETE FROM host_sessions WHERE token_hash=?",
  );
  const guestToken = (device,epoch=game.epoch) =>
    createHmac("sha256", secret).update(epoch?`guest:${epoch}:${device}`:`guest:${device}`).digest("base64url");
  const maxPlayers = options.maxPlayers || 1500;
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: "1mb" }));
  app.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  const origins = new Set(
    options.origins ||
      (process.env.AWARDS_ALLOWED_ORIGINS
        ? process.env.AWARDS_ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)
        : [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:4173",
          ]),
  );
  app.use((req, _res, next) => {
    if (
      !["GET", "HEAD"].includes(req.method) &&
      (!origins.has(req.get("origin")) || req.get("x-awards-request") !== "1")
    )
      return next(new RequestError(403, "Request origin is not allowed."));
    next();
  });
  const cookieToken = (req) =>
    String(req.headers.cookie || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("awards_host="))
      ?.slice(12) || "";
  const isHost = (req) => {
    const token = cookieToken(req);
    return !!token && (sessionGet.get(sha(token))?.expires || 0) > Date.now();
  };
  const hostOnly = (req, _res, next) =>
    isHost(req)
      ? next()
      : next(new RequestError(401, "Host sign-in required."));
  const guest = (req) => {
    const token = req.get("x-awards-token");
    const p =
      token && token.length < 200 ? playerByToken.get(sha(token)) : null;
    if (!p) throw new RequestError(401, "Please rejoin the game.");
    return p;
  };
  let cache;
  const correctFor = (c) => game.answers?.[c.id] || [];
  function snapshot() {
    if (cache) return cache;
    const players = allPlayers
      .all()
      .map((p) => ({
        ...p,
        picks: {},
        drafts: {},
        pickVersions: {},
        sample: false,
        score: 0,
      }));
    const byId = new Map(players.map((p) => [p.id, p]));
    const voteTotals = Object.fromEntries(
      game.categories.map((c) => [
        c.id,
        Object.fromEntries(c.nominees.map((n) => [n.id, 0])),
      ]),
    );
    for (const v of allVotes.all()) {
      const p = byId.get(v.player_id);
      if (p) {
        p.picks[v.category_id] = v.nominee_id;
        p.pickVersions[v.category_id] = v.version;
      }
      if (voteTotals[v.category_id]?.[v.nominee_id] !== undefined)
        voteTotals[v.category_id][v.nominee_id]++;
    }
    for (const p of players) {
      p.score = game.categories.reduce(
        (n, c) => n + Number(c.status==='locked' && correctFor(c).includes(p.picks[c.id])),
        0,
      );
      p.answered = Object.keys(p.picks).length;
      p.roundScores=Object.fromEntries([...new Set(game.categories.map(c=>c.group))].map(group=>[group,game.categories.filter(c=>c.group===group).reduce((n,c)=>n+Number(c.status==='locked'&&correctFor(c).includes(p.picks[c.id])),0)]));
    }
    const draftCounts=Object.fromEntries(game.categories.map(c=>[c.id,0]));
    for(const d of allDrafts.all()) {
      const p=byId.get(d.player_id);
      if(p){p.drafts[d.category_id]=d.nominee_id;p.pickVersions[d.category_id]=d.version;draftCounts[d.category_id]++;}
    }
    const rankings = [...players].sort(
      (a, b) =>
        b.score - a.score ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    );
    let rank = 1;
    rankings.forEach((p, i) => {
      if (i && p.score !== rankings[i - 1].score) rank = i + 1;
      p.rank = rank;
    });
    cache = { players, byId, rankings, voteTotals, draftCounts };
    return cache;
  }
  function publicPlayer(p) {
    if(!p)return null;
    const {id,name,tableNumber,picks,drafts,pickVersions}=p;
    return {id,name,tableNumber,picks,drafts,pickVersions};
  }
  function stateFor(req, host = false) {
    const s = snapshot();
    const me = !host && req.get("x-awards-token") ? s.byId.get(guest(req).id) : null;
    const { answers: _answers, raffle: _raffle, ...publicGame } = game;
    return {
      ...publicGame,
      categories:game.categories.map(({winner,winners,...category})=>category),
      rounds:[...new Set(game.categories.map(c=>c.group))].map((name,i)=>({id:`round-${i+1}`,name,questionIds:game.categories.filter(c=>c.group===name).map(c=>c.id)})),
      serverNow: Date.now(),
      playerCount: s.players.length,
      players: host ? s.players : me ? [publicPlayer(me)] : [],
      voteTotals: host ? s.voteTotals : {},
      ...(host
        ? {
            rankings: s.rankings,
            draftCounts: s.draftCounts,
            firstPlaceCount: s.rankings.filter((p) => p.rank === 1).length,
            correctAnswers: game.answers,
            raffle: game.raffle || null,
            serverConnected: true,
          }
        : { serverConnected: true }),
    };
  }
  const streams = new Set();
  let broadcastTimer;
  function notify() {
    if (!broadcastTimer)
      broadcastTimer = setTimeout(() => {
        broadcastTimer = null;
        for (const res of streams)
          if (
            !res.write(
              `id: ${game.revision}\nevent: update\ndata: ${game.revision}\n\n`,
            )
          )
            res.destroy();
      }, 100);
  }
  let queue = [],
    batchTimer;
  function enqueue(res, run) {
    if (queue.length >= 5000)
      return res
        .status(503)
        .json({ error: "Server is busy. Retry this request." });
    queue.push({ res, run });
    if (!batchTimer) batchTimer = setTimeout(flush, 5);
  }
  function flush() {
    batchTimer = null;
    const batch = queue;
    queue = [];
    if (!batch.length) return;
    const ctx = { game: structuredClone(game),afterCommit:[],usedClears:new Set() };
    const results = [];
    try {
      db.exec("BEGIN IMMEDIATE");

      for (const job of batch) {
        try {
          results.push({ job, value: job.run(ctx) });
        } catch (error) {
          if (!(error instanceof RequestError)) throw error;
          results.push({ job, error });
        }
      }
      ctx.game.revision++;
      configSave.run(JSON.stringify(ctx.game));
      db.exec("COMMIT");
      for(const callback of ctx.afterCommit)callback();
      game = ctx.game;
      cache = null;
      for (const { job, value, error } of results)
        if (!job.res.destroyed)
          error
            ? job.res.status(error.status).json({ error: error.message })
            : job.res.json(typeof value === "function" ? value() : value);
      notify();
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {}
      console.error("Awards transaction failed:", error.message);
      for (const job of batch)
        if (!job.res.destroyed)
          job.res
            .status(503)
            .json({ error: "Could not save. Please retry the same request." });
    }
  }
  const loginAttempts = new Map();
  const loginCleanup = setInterval(() => {
    for (const [ip, a] of loginAttempts)
      if (a.until < Date.now()) loginAttempts.delete(ip);
  }, 60000);
  loginCleanup.unref();
  app.get("/api/awards/health", (_req, res) =>
    res.json({ ok: true, storage: "sqlite-wal", dataset: game.dataset }),
  );
  app.get("/api/awards/session", (req, res) =>
    res.json({ authenticated: isHost(req) }),
  );
  app.post("/api/awards/session", (req, res, next) => {
    const ip = req.socket.remoteAddress;
    let attempt = loginAttempts.get(ip);
    if (!attempt || attempt.until < Date.now())
      attempt = { count: 0, until: Date.now() + 60000 };
    loginAttempts.set(ip, attempt);
    if (++attempt.count > 10)
      return next(
        new RequestError(
          429,
          "Too many sign-in attempts. Try again in one minute.",
        ),
      );
    const password =
      typeof req.body.password === "string" ? req.body.password : "";
    if (
      password.length > 200 ||
      !timingSafeEqual(scryptSync(password, passwordSalt, 32), passwordHash)
    )
      return next(new RequestError(401, "Incorrect host password."));
    loginAttempts.delete(ip);
    const token = randomBytes(32).toString("base64url");
    sessionSave.run(sha(token), Date.now() + 12 * 60 * 60 * 1000);
    res.cookie("awards_host", token, {
      httpOnly: true,
      secure: production,
      sameSite: "strict",
      path: "/api/awards",
      maxAge: 12 * 60 * 60 * 1000,
    });
    res.json({ authenticated: true });
  });
  app.delete("/api/awards/session", (req, res) => {
    sessionDelete.run(sha(cookieToken(req)));
    res.clearCookie("awards_host", {
      path: "/api/awards",
      httpOnly: true,
      secure: production,
      sameSite: "strict",
    });
    res.json({ ok: true });
  });
  app.post("/api/awards/join", (req, res, next) => {
    try {
      const { deviceId, name, tableNumber } = req.body;
      fail(
        typeof deviceId !== "string" || !/^[a-zA-Z0-9-]{30,80}$/.test(deviceId),
        400,
        "Invalid join identifier.",
      );
      fail(
        typeof name !== "string" || !name.trim() || name.trim().length > 80,
        400,
        "Enter a name of 1–80 characters.",
      );
      fail(typeof tableNumber !== "string" || !/^[1-9][0-9]{0,3}$/.test(tableNumber.trim()), 400, "Enter a valid table number (1–9999).");
      enqueue(res, (ctx) => {
        let p = playerByDevice.get(deviceId);
        const token = guestToken(deviceId,ctx.game.epoch);
        if (!p) {
          fail(
            countPlayers.get().count >= maxPlayers,
            503,
            "The participant limit has been reached. Contact the host.",
          );
          const id = randomUUID();
          playerInsert.run(id, deviceId, sha(token), name.trim(), Date.now(), tableNumber.trim());
          p = { id };
        } else if (!p.table_number) {
          db.prepare('UPDATE players SET table_number=? WHERE id=?').run(tableNumber.trim(),p.id);
        }
        return () => ({ token, player: publicPlayer(snapshot().byId.get(p.id)) });
      });
    } catch (e) {
      next(e);
    }
  });
  app.get("/api/awards/state", (req, res, next) => {
    try {
      res.json(stateFor(req));
    } catch (e) {
      next(e);
    }
  });
  app.get("/api/awards/host/state", hostOnly, (req, res, next) => {
    try {
      res.json(stateFor(req, true));
    } catch (e) {
      next(e);
    }
  });
  app.post(["/api/awards/votes", "/api/awards/drafts"], (req, res, next) => {
    try {
      const isDraft=req.path.endsWith('/drafts');
      const p = guest(req);
      const { categoryId, nomineeId, requestId, expectedVersion } = req.body;
      fail(
        typeof requestId !== "string" ||
          !/^[a-zA-Z0-9-]{20,80}$/.test(requestId),
        400,
        "Invalid submission identifier.",
      );
      fail(
        !Number.isSafeInteger(expectedVersion) || expectedVersion < 0,
        400,
        "Invalid answer version.",
      );
      const payloadHash = sha(
        JSON.stringify([isDraft, categoryId, nomineeId, expectedVersion]),
      );
      enqueue(res, (ctx) => {
        fail(playerByToken.get(sha(req.get('x-awards-token')||''))?.id!==p.id,401,'The game was cleared. Join again to participate.');
        const receipt = receiptGet.get(p.id, requestId);
        if (receipt) {
          fail(
            receipt.payload_hash !== payloadHash,
            409,
            "This request identifier was already used for another answer.",
          );
          return () => ({ player: publicPlayer(snapshot().byId.get(p.id)), duplicate: true });
        }
        const c = ctx.game.categories.find((c) => c.id === categoryId);
        fail(
          !c || !c.nominees.some((n) => n.id === nomineeId),
          400,
          "Choose a nominee in this category.",
        );
        fail(
          ctx.game.finalPublished ||
            c.status !== "open" ||
            ctx.game.active !== c.id,
          409,
          "Predictions for this category are closed.",
        );
        const version = draftGet.get(p.id,c.id)?.version || voteGet.get(p.id, c.id)?.version || 0;
        fail(
          version !== expectedVersion,
          409,
          "Your answer changed in another tab. Refresh and try again.",
        );
        (isDraft?draftSave:voteSave).run(p.id, c.id, nomineeId, version + 1, Date.now());
        if(!isDraft) db.prepare('DELETE FROM drafts WHERE player_id=? AND category_id=?').run(p.id,c.id);
        receiptSave.run(p.id, requestId, payloadHash);
        return () => ({ player: publicPlayer(snapshot().byId.get(p.id)), duplicate: false });
      });
    } catch (e) {
      next(e);
    }
  });
  const clearConfirmations=new Map();
  app.post('/api/awards/host/clear/prepare',hostOnly,(req,res,next)=>{
    try{
      fail(req.body.confirmation!=='CLEAR ALL',400,'The first clear confirmation is required.');
      for(const [token,item] of clearConfirmations)if(item.expires<Date.now())clearConfirmations.delete(token);
      const challenge=randomBytes(32).toString('base64url');
      clearConfirmations.set(challenge,{host:sha(cookieToken(req)),epoch:game.epoch,expires:Date.now()+300000,used:false});
      res.json({challenge,expiresAt:Date.now()+300000});
    }catch(e){next(e);}
  });
  app.post("/api/awards/host/command", hostOnly, (req, res, next) => {
    try {
      const { type, categoryId, roundId, mode, patch, confirmation, durationSeconds, challenge } = req.body;
      enqueue(res, (ctx) => {
        const s = ctx.game;
        const c = s.categories.find((c) => c.id === categoryId);
        fail(
          s.finalPublished && !['reset','clear-all','raffle','theme','theme-reset'].includes(type),
          409,
          "The game is finalized. Reset is required to start another game.",
        );
        if(type==='clear-all') {
          const approved=clearConfirmations.get(challenge);
          fail(confirmation!=='CLEAR ALL'||!approved||approved.expires<Date.now(),400,'Both confirmations are required. Start the clear process again.');
          fail(approved.host!==sha(cookieToken(req)),403,'Complete both confirmations in the same host session.');
          if(approved.used||ctx.usedClears.has(challenge))return()=>stateFor(req,true);
          fail(approved.epoch!==s.epoch,409,'The game has already been cleared. Start again if another clear is needed.');
          db.exec('DELETE FROM receipts; DELETE FROM votes; DELETE FROM drafts; DELETE FROM players;');
          ctx.game={...s,epoch:randomUUID(),active:s.categories[0].id,mode:'live',screen:'question',roundId:null,finalPublished:false,raffle:null,categories:s.categories.map(c=>({...c,status:'waiting',startedAt:null,endsAt:null,closedAt:null,remainingMs:null,winner:null,winners:[]}))};
          ctx.usedClears.add(challenge);
          ctx.afterCommit.push(()=>{approved.used=true;});
        } else if(type==='round') {
          const groups=[...new Set(s.categories.map(c=>c.group))];
          const index=groups.findIndex((_g,i)=>`round-${i+1}`===roundId);
          fail(index<0,400,'Choose a valid round.');
          for(const c of s.categories)if(c.status==='open')finishCategory(c);
          s.active=s.categories.find(c=>c.group===groups[index]).id;s.screen='round';s.roundId=roundId;
        } else if (type === "mode") {
          fail(mode!=='live',400,'Only the host can advance questions. All-question mode is disabled.');
          s.mode='live';
        } else if (type === "reveal" || type === "publish") {
          throw new RequestError(400,"Winner reveals and public results are disabled.");
        } else if (type === "answer") {
          fail(!c, 400, "Unknown category.");
          const nominee = c.nominees.find((n) => n.id === req.body.nomineeId);
          fail(!nominee, 400, "Unknown nominee.");
          fail(typeof req.body.correct !== "boolean", 400, "Specify whether the answer is correct.");
          const current = new Set(s.answers?.[c.id] || []);
          if (req.body.correct) current.add(nominee.id); else current.delete(nominee.id);
          s.answers = { ...(s.answers || {}), [c.id]: c.nominees.filter((n) => current.has(n.id)).map((n) => n.id) };
        } else if (type === "theme-reset") {
          s.theme = { texts: {}, colors: {}, logo: "" };
        } else if (type === "theme") {
          fail(!patch || typeof patch !== "object" || Array.isArray(patch), 400, "Invalid appearance changes.");
          const next = { texts: { ...(s.theme?.texts || {}) }, colors: { ...(s.theme?.colors || {}) }, logo: s.theme?.logo || "" };
          if (patch.texts !== undefined) {
            fail(!patch.texts || typeof patch.texts !== "object" || Array.isArray(patch.texts) || Object.keys(patch.texts).length > 80, 400, "Invalid text changes.");
            for (const [k, v] of Object.entries(patch.texts)) {
              fail(!/^[a-zA-Z][a-zA-Z0-9]{0,40}$/.test(k) || typeof v !== "string" || v.length > 600, 400, "Each text must be 600 characters or fewer.");
              const clean = v.replace(/[^\P{C}\n]/gu, "").trim();
              if (clean) next.texts[k] = clean; else delete next.texts[k];
            }
          }
          if (patch.colors !== undefined) {
            fail(!patch.colors || typeof patch.colors !== "object" || Array.isArray(patch.colors) || Object.keys(patch.colors).length > 20, 400, "Invalid colour changes.");
            for (const [k, v] of Object.entries(patch.colors)) {
              fail(!/^[a-zA-Z][a-zA-Z0-9]{0,40}$/.test(k) || typeof v !== "string" || (v && !/^#[0-9a-fA-F]{6}$/.test(v)), 400, "Colours must be six-digit hex values.");
              if (v) next.colors[k] = v.toLowerCase(); else delete next.colors[k];
            }
          }
          if (patch.logo !== undefined) {
            fail(typeof patch.logo !== "string" || patch.logo.length > 200000 || (patch.logo && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(patch.logo)), 400, "Choose a PNG, JPG or WebP logo smaller than 150 KB.");
            next.logo = patch.logo;
          }
          s.theme = next;
        } else if (type === "raffle") {
          fail(s.categories.some((c) => c.status !== "locked"), 409, "Finish every question before the raffle draw.");
          const leaders = snapshot().rankings.filter((p) => p.rank === 1);
          fail(leaders.length < 2, 409, "There is no tie for first place.");
          const pick = leaders[randomInt(leaders.length)];
          s.raffle = { playerId: pick.id, name: pick.name, tableNumber: pick.tableNumber, score: pick.score, candidates: leaders.map((p) => p.id), drawnAt: Date.now(), draws: (s.raffle?.draws || 0) + 1 };
        } else if (type === "finalize") {
          fail(
            s.categories.some((c) => c.status!=='locked'),
            409,
            "Close every category before finalizing private results.",
          );
          s.finalPublished = true;
        } else if (type === "reset") {
          fail(
            confirmation !== "RESET GAME",
            400,
            "Reset confirmation required.",
          );
          db.exec("DELETE FROM receipts; DELETE FROM votes; DELETE FROM drafts;");
          ctx.game = { ...seed(), answers: structuredClone(s.answers), theme: structuredClone(s.theme || { texts: {}, colors: {}, logo: "" }), epoch:s.epoch, revision: s.revision };
        } else {
          fail(!c, 400, "Unknown category.");
          if(['duration','pause','resume','reset-timer'].includes(type)) {
            throw new RequestError(400,'Timers are disabled. Use Start question or End question.');
          } else if (type === "open") {
            // Duplicate Start commands must not restart an already open question.
            if(c.status==='open'&&s.active===c.id)return()=>stateFor(req,true);
            s.active = c.id;
            s.screen='question';s.roundId=null;
            for (const other of s.categories)
              if (['open','paused'].includes(other.status)) finishCategory(other);
            startCategory(c);
          } else if (type === "lock" || type === "end") {
            if(c.status==='locked')return()=>stateFor(req,true);
            fail(c.status!=='open',409,'Start the question before ending it.');
            finishCategory(c);
          } else if (type === "edit") {
            fail(
              !patch || typeof patch !== "object",
              400,
              "Invalid category changes.",
            );
            if (patch.name !== undefined) {
              fail(
                typeof patch.name !== "string" ||
                  !patch.name.trim() ||
                  patch.name.length > 140,
                400,
                "Enter a category name of 1–140 characters.",
              );
            }
            if (patch.nominees !== undefined) {
              fail(
                !Array.isArray(patch.nominees) ||
                  patch.nominees.length !== c.nominees.length,
                400,
                "Nominee IDs and counts must be preserved.",
              );
              const edited = c.nominees.map((n) => {
                const value = patch.nominees.find((x) => x.id === n.id);
                fail(
                  !value ||
                    typeof value.name !== "string" ||
                    !value.name.trim() ||
                    value.name.length > 100,
                  400,
                  "Enter a company name of 1–100 characters.",
                );
                fail(
                  typeof value.logo !== "string" ||
                    value.logo.length > 700000 ||
                    (!value.logo.startsWith("/awards/nominees/") &&
                      !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(
                        value.logo,
                      )),
                  400,
                  "Unsupported logo.",
                );
                return { ...n, name: value.name.trim(), logo: value.logo };
              });
              c.nominees = edited;
            }
            if (patch.name !== undefined) c.name = patch.name.trim();
          } else throw new RequestError(400, "Unknown host command.");
        }
        return () => stateFor(req, true);
      });
    } catch (e) {
      next(e);
    }
  });
  app.get("/api/awards/events", (req, res) => {
    if (streams.size >= 2000) return res.status(503).end();
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    res.write(`retry: 1500\nevent: update\ndata: ${game.revision}\n\n`);
    streams.add(res);
    const heartbeat = setInterval(() => {
      if (!res.write(": heartbeat\n\n")) res.destroy();
    }, 15000);
    res.on("close", () => {
      clearInterval(heartbeat);
      streams.delete(res);
    });
  });
  app.use((_req, res) => res.status(404).json({ error: "Not found." }));
  app.use((e, _req, res, _next) => {
    res
      .status(e.status || 500)
      .json({ error: e.status ? e.message : "Server error. Please retry." });
  });
  const close = () => {
    clearTimeout(batchTimer);
    flush();
    clearTimeout(broadcastTimer);
    clearInterval(loginCleanup);
    for (const res of streams) res.end();
    db.close();
  };
  return {
    app,
    close,
    db,
    stats: () => ({
      players: countPlayers.get().count,
      streams: streams.size,
      queued: queue.length,
    }),
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const service = createAwardsService();
  const port = Number(process.env.AWARDS_PORT || 8788);
  const server = service.app.listen(port, "127.0.0.1", () =>
    console.log(
      `Awards API: http://127.0.0.1:${port}; local host password: .private/host-access.txt`,
    ),
  );
  server.requestTimeout = 15000;
  server.headersTimeout = 20000;
  server.keepAliveTimeout = 65000;
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    service.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
