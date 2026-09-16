export const STORAGE_KEY = "guess-the-winner-preview-v1";
export const companies = [
  {
    id: "n1",
    name: "Aster Facilities",
    mark: "aster",
    color: "#246252",
    logo: "",
  },
  { id: "n2", name: "Nexa Services", mark: "NEXA", color: "#4262a5", logo: "" },
  { id: "n3", name: "Verde Group", mark: "verde", color: "#4e7537", logo: "" },
  { id: "n4", name: "Orbit FM", mark: "orbit", color: "#9a5744", logo: "" },
  {
    id: "n5",
    name: "Elevate Solutions",
    mark: "ELEVATE",
    color: "#775890",
    logo: "",
  },
];
export function createDemo() {
  const names = [
    "Excellence in Service Delivery",
    "Sustainability & Environmental Impact",
    "Innovation in Facilities Management",
    "Customer Experience",
    "People & Culture",
    "Health, Safety & Wellbeing",
  ];
  const categories = names.map((name, i) => ({
    id: `c${i}`,
    name,
    nominees: structuredClone(companies.slice(0, i % 2 ? 4 : 5)),
    status: i < 2 ? "revealed" : i === 2 ? "open" : "waiting",
    winner: i < 2 ? `n${i + 1}` : null,
  }));
  const first = [
    "Amira",
    "Omar",
    "Sara",
    "Khalid",
    "Maya",
    "Daniel",
    "Lina",
    "James",
    "Noor",
    "Ahmed",
  ];
  const last = [
    "Hassan",
    "Ali",
    "Morgan",
    "Khan",
    "Saleh",
    "Wilson",
    "Ibrahim",
    "Thomas",
    "Malik",
    "Ahmed",
  ];
  const players = Array.from({ length: 500 }, (_, i) => ({
    id: `demo-${i}`,
    name: `${first[i % 10]} ${last[Math.floor(i / 10) % 10]}${i >= 100 ? ` ${Math.floor(i / 100) + 1}` : ""}`,
    sample: true,
    picks: Object.fromEntries(
      categories
        .slice(0, i < 432 ? 3 : 2)
        .map((c, j) => [
          c.id,
          c.nominees[(i * (j + 1) + Math.floor(i / 7)) % c.nominees.length].id,
        ]),
    ),
  }));
  return {
    version: 1,
    mode: "live",
    active: "c2",
    categories,
    players,
    finalPublished: false,
  };
}
export function canPredict(state, category) {
  return (
    !!category &&
    !state.finalPublished &&
    category.status === "open" &&
    !category.winner &&
    (state.mode === "all" || state.active === category.id)
  );
}
export function submitPick(state, playerId, categoryId, nomineeId) {
  const category = state.categories.find((c) => c.id === categoryId);
  if (
    !canPredict(state, category) ||
    !category.nominees.some((n) => n.id === nomineeId) ||
    !state.players.some((p) => p.id === playerId)
  )
    return state;
  return {
    ...state,
    players: state.players.map((p) =>
      p.id === playerId
        ? { ...p, picks: { ...p.picks, [categoryId]: nomineeId } }
        : p,
    ),
  };
}
export function standings(state) {
  const rows = state.players
    .map((p) => ({
      ...p,
      score: state.categories.reduce(
        (sum, c) => sum + Number(!!c.winner && p.picks[c.id] === c.winner),
        0,
      ),
      answered: Object.keys(p.picks).length,
    }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return rows.map((p, i) => ({
    ...p,
    rank:
      i && p.score === rows[i - 1].score
        ? rows.findIndex((r) => r.score === p.score) + 1
        : i + 1,
  }));
}
export function totals(state, category) {
  return category.nominees.map((n) => ({
    ...n,
    votes: state.players.filter((p) => p.picks[category.id] === n.id).length,
  }));
}
export function revealWinner(state, categoryId, nomineeId) {
  const category = state.categories.find((c) => c.id === categoryId);
  if (
    !category ||
    category.status !== "locked" ||
    !category.nominees.some((n) => n.id === nomineeId)
  )
    return state;
  return {
    ...state,
    categories: state.categories.map((c) =>
      c.id === categoryId ? { ...c, winner: nomineeId, status: "revealed" } : c,
    ),
  };
}
