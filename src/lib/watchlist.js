const KEY = 'vs-watchlist';
const MAX = 20;

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}

function write(list) {
  localStorage.setItem(KEY, JSON.stringify(list));
}

export function getWatchlist() {
  return read();
}

export function addToWatchlist(ticker) {
  const list = read();
  if (!list.includes(ticker)) {
    write([ticker, ...list].slice(0, MAX));
  }
}

export function removeFromWatchlist(ticker) {
  write(read().filter((t) => t !== ticker));
}

export function isWatched(ticker) {
  return read().includes(ticker);
}
