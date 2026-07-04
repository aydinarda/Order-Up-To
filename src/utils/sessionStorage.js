/**
 * Session Storage Utilities
 * Handles localStorage persistence and URL parameter sync for game session
 */

const SESSION_KEY = 'gameSession';

/**
 * Save game session to localStorage
 */
export function saveGameSession(sessionData) {
  try {
    const data = {
      gameId: sessionData.gameId,
      playerId: sessionData.playerId,
      nickname: sessionData.nickname,
      isAdmin: sessionData.isAdmin,
      adminToken: sessionData.adminToken,
      timestamp: Date.now(),
      roundPhase: sessionData.roundPhase
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(data));
  } catch (error) {
    console.warn('Failed to save game session to localStorage:', error);
  }
}

/**
 * Load game session from localStorage
 */
export function loadGameSession() {
  try {
    const saved = localStorage.getItem(SESSION_KEY);
    if (!saved) {
      return null;
    }
    return JSON.parse(saved);
  } catch (error) {
    console.warn('Failed to load game session from localStorage:', error);
    return null;
  }
}

/**
 * Clear game session from localStorage
 */
export function clearGameSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch (error) {
    console.warn('Failed to clear game session:', error);
  }
}

/**
 * Update URL with game session parameters
 * This allows sharing the link and bookmarking
 */
export function updateUrlWithSession(gameId, playerId) {
  const newUrl = new URL(window.location);
  newUrl.searchParams.set('gameId', gameId);
  newUrl.searchParams.set('playerId', playerId);
  window.history.replaceState({}, '', newUrl);
}

/**
 * Get session data from URL parameters
 */
export function getSessionFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const gameId = params.get('gameId');
    const playerId = params.get('playerId');

    if (!gameId || !playerId) {
      return null;
    }

    return { gameId, playerId };
  } catch (error) {
    console.warn('Failed to read session from URL:', error);
    return null;
  }
}

/**
 * Clear URL session parameters
 */
export function clearUrlSession() {
  const newUrl = new URL(window.location);
  newUrl.searchParams.delete('gameId');
  newUrl.searchParams.delete('playerId');
  window.history.replaceState({}, '', newUrl);
}
