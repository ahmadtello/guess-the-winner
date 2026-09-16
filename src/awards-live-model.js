import shortlist from "./awards-shortlist.json" with { type: "json" };
export const getRounds=(categories)=>[...new Set(categories.map(c=>c.group))].map((name,i)=>({id:`round-${i+1}`,name,questions:categories.filter(c=>c.group===name)}));
export function emptyGame() {
  return {
    version: 3,
    dataset: shortlist.dataset,
    mode: "live",
    questionControl: "manual",
    active: shortlist.categories[0].id,
    categories: shortlist.categories.map((c, i) => ({
      ...structuredClone(c),
      status: "waiting",
      durationSeconds: null,
      startedAt: null,
      endsAt: null,
      winner: null,
      winners: [],
    })),
    players: [],
    playerCount: 0,
    finalPublished: false,
    serverConnected: false,
    revision: -1,
  };
}
export const isWinner = (category, id) =>
  !!id && (category.winners || []).includes(id);
export function canPredict(state, category) {
  return (
    !!category &&
    state.serverConnected &&
    !state.finalPublished &&
    category.status === "open" &&
    !category.winner &&
    state.active === category.id
  );
}
export function standings(state) {
  if (state.rankings) return state.rankings;
  const rows = state.players
    .map((p) => ({
      ...p,
      score: state.categories.reduce(
        (n, c) => n + Number(isWinner(c, p.picks[c.id])),
        0,
      ),
      answered: Object.keys(p.picks).length,
    }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  let rank = 1;
  return rows.map((p, i) => {
    if (i && p.score !== rows[i - 1].score) rank = i + 1;
    return { ...p, rank };
  });
}
export function totals(state, category) {
  return category.nominees.map((n) => ({
    ...n,
    votes:
      state.voteTotals?.[category.id]?.[n.id] ??
      state.players.filter((p) => p.picks[category.id] === n.id).length,
  }));
}
