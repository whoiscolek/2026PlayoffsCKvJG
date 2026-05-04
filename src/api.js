export async function loadTodayGames() {
  const response = await fetch(`/api/today-games?_=${Date.now()}`);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Could not load games: ${text}`);
  }
  return response.json();
}
