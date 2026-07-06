/**
 * Anime Guess Game
 * Uses Jikan API v4 (https://jikan.moe/)
 * Optimized for browser and Telegram Mini App usage.
 */

const CONFIG = {
    API_BASE: 'https://api.jikan.moe/v4',
    ENDPOINTS: {
        RANDOM_ANIME: '/random/anime',
        ANIME_PICTURES: (id) => `/anime/${id}/pictures`,
        ANIME_SEARCH: '/anime'
    },
    XP_PER_CORRECT: 100,
    XP_STREAK_BONUS: 50,
    MAX_STREAK_BONUS: 500,
    OPTIONS_COUNT: 4,
    REQUEST_DELAY: 800,
    REQUEST_TIMEOUT: 12000,
    MAX_RETRIES: 3,
    MAX_ROUND_ATTEMPTS: 6,
    DISTRACTOR_FETCH_SIZE: 18,
    DISTRACTOR_CACHE_TARGET: 18,
    MAX_RECENT_ANIME: 12,
    PREFETCH_QUEUE_TARGET: 2,
    PREFETCH_IDLE_DELAY: 350,
    TELEGRAM_CHANNEL: 'https://t.me/botmorph',
    STORAGE_KEYS: {
        XP: 'anime_guess_xp',
        STREAK: 'anime_guess_streak',
        TOTAL_PLAYED: 'anime_guess_total',
        BEST_STREAK: 'anime_guess_best_streak'
    }
};

const state = {
    xp: 0,
    streak: 0,
    totalPlayed: 0,
    bestStreak: 0,
    currentAnime: null,
    currentOptions: [],
    currentImageCandidates: [],
    recentAnimeIds: [],
    distractorCache: [],
    prefetchedRounds: [],
    isLoading: false,
    answerSubmitted: false,
    isOffline: typeof navigator !== 'undefined' ? !navigator.onLine : false,
    lastRequestTime: 0,
    telegram: null,
    prefetchPromise: null,
    prefetchScheduled: false
};

const elements = {
    loadingOverlay: null,
    gameCard: null,
    animeImage: null,
    optionsGrid: null,
    feedbackArea: null,
    nextBtn: null,
    telegramBtn: null,
    xpDisplay: null,
    streakDisplay: null,
    totalDisplay: null,
    connectionStatus: null
};

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampRecentAnime(animeId) {
    if (!animeId) {
        return;
    }

    state.recentAnimeIds.unshift(animeId);
    state.recentAnimeIds = state.recentAnimeIds
        .filter((id, index, array) => array.indexOf(id) === index)
        .slice(0, CONFIG.MAX_RECENT_ANIME);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text ?? '';
    return div.innerHTML;
}

function formatNumber(num) {
    return Number(num || 0).toLocaleString();
}

function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function runWhenIdle(callback, delay = CONFIG.PREFETCH_IDLE_DELAY) {
    if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(callback, { timeout: 1200 });
        return;
    }

    window.setTimeout(callback, delay);
}

function getPrimaryTitle(anime) {
    if (!anime) {
        return 'Unknown Anime';
    }

    return anime.title_english || anime.title || anime.title_japanese || 'Unknown Anime';
}

function normalizeTitle(title) {
    return String(title || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function isSafeRating(anime) {
    const rating = anime?.rating || '';
    return !rating.startsWith('Rx') && !rating.startsWith('R+');
}

function isAllowedType(anime) {
    const allowedTypes = new Set(['TV', 'Movie', 'OVA', 'ONA', 'Special']);
    return allowedTypes.has(anime?.type);
}

function isAnimePlayable(anime, excludedIds = []) {
    if (!anime || typeof anime !== 'object') {
        return false;
    }

    if (!anime.approved || !anime.mal_id || !getPrimaryTitle(anime)) {
        return false;
    }

    if (excludedIds.includes(anime.mal_id) || state.recentAnimeIds.includes(anime.mal_id)) {
        return false;
    }

    if (!isAllowedType(anime) || !isSafeRating(anime)) {
        return false;
    }

    if (Array.isArray(anime.explicit_genres) && anime.explicit_genres.length > 0) {
        return false;
    }

    return true;
}

function buildApiUrl(endpoint, params) {
    const url = new URL(`${CONFIG.API_BASE}${endpoint}`);
    if (params) {
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                url.searchParams.set(key, String(value));
            }
        });
    }
    return url.toString();
}

async function rateLimitedFetch(url, options = {}) {
    const now = Date.now();
    const elapsed = now - state.lastRequestTime;

    if (elapsed < CONFIG.REQUEST_DELAY) {
        await sleep(CONFIG.REQUEST_DELAY - elapsed);
    }

    for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt += 1) {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);

        try {
            state.lastRequestTime = Date.now();

            const response = await fetch(url, {
                ...options,
                signal: controller.signal,
                headers: {
                    Accept: 'application/json',
                    ...options.headers
                }
            });

            if (!response.ok) {
                if (response.status === 429 || response.status >= 500) {
                    await sleep(attempt * 1200);
                    continue;
                }

                throw new Error(`API request failed with status ${response.status}`);
            }

            const payload = await response.json();

            if (!payload || typeof payload !== 'object' || !('data' in payload)) {
                throw new Error('API returned an unexpected response.');
            }

            return payload.data;
        } catch (error) {
            const isFinalAttempt = attempt === CONFIG.MAX_RETRIES;
            const isAbort = error?.name === 'AbortError';
            const message = isAbort
                ? 'The request timed out. Please try again.'
                : (error?.message || 'Unable to complete the request.');

            console.warn(`Request attempt ${attempt} failed for ${url}:`, message);

            if (isFinalAttempt) {
                throw new Error(message);
            }

            await sleep(attempt * 800);
        } finally {
            window.clearTimeout(timeoutId);
        }
    }

    throw new Error('Request failed after multiple attempts.');
}

async function fetchRandomAnime() {
    const data = await rateLimitedFetch(buildApiUrl(CONFIG.ENDPOINTS.RANDOM_ANIME));
    return data;
}

async function fetchAnimePictures(animeId) {
    try {
        const data = await rateLimitedFetch(buildApiUrl(CONFIG.ENDPOINTS.ANIME_PICTURES(animeId)));
        return Array.isArray(data) ? data : [];
    } catch (error) {
        console.warn(`Unable to fetch pictures for anime ${animeId}:`, error.message);
        return [];
    }
}

async function fetchDistractorBatch(excludeIds = []) {
    const orderByOptions = ['popularity', 'score', 'members'];
    const orderBy = orderByOptions[Math.floor(Math.random() * orderByOptions.length)];
    const page = Math.floor(Math.random() * 8) + 1;
    const params = {
        page,
        limit: CONFIG.DISTRACTOR_FETCH_SIZE,
        order_by: orderBy,
        sort: 'desc',
        sfw: true
    };

    const data = await rateLimitedFetch(buildApiUrl(CONFIG.ENDPOINTS.ANIME_SEARCH, params));

    return Array.isArray(data)
        ? data.filter((anime) => isAnimePlayable(anime, excludeIds))
        : [];
}

function extractImageCandidates(anime, pictures = []) {
    const urls = [];
    const seen = new Set();

    const pushUrl = (value) => {
        if (typeof value !== 'string') {
            return;
        }

        const normalized = value.trim();
        if (!normalized || seen.has(normalized)) {
            return;
        }

        seen.add(normalized);
        urls.push(normalized);
    };

    pictures.forEach((picture) => {
        pushUrl(picture?.jpg?.large_image_url);
        pushUrl(picture?.jpg?.image_url);
        pushUrl(picture?.webp?.large_image_url);
        pushUrl(picture?.webp?.image_url);
        pushUrl(picture?.large);
        pushUrl(picture?.image_url);
    });

    pushUrl(anime?.images?.webp?.large_image_url);
    pushUrl(anime?.images?.webp?.image_url);
    pushUrl(anime?.images?.jpg?.large_image_url);
    pushUrl(anime?.images?.jpg?.image_url);
    pushUrl(anime?.trailer?.images?.maximum_image_url);
    pushUrl(anime?.trailer?.images?.large_image_url);
    pushUrl(anime?.trailer?.images?.medium_image_url);

    return urls;
}

function pruneDistractorCache() {
    const usedTitles = new Set();
    state.distractorCache = state.distractorCache.filter((anime) => {
        if (!isAnimePlayable(anime) || anime.mal_id === state.currentAnime?.mal_id) {
            return false;
        }

        const titleKey = normalizeTitle(getPrimaryTitle(anime));
        if (!titleKey || usedTitles.has(titleKey)) {
            return false;
        }

        usedTitles.add(titleKey);
        return true;
    }).slice(0, CONFIG.DISTRACTOR_CACHE_TARGET * 2);
}

async function ensureDistractorCache(excludeIds = [], needed = CONFIG.OPTIONS_COUNT - 1) {
    pruneDistractorCache();

    const availableCount = state.distractorCache.filter(
        (anime) => !excludeIds.includes(anime.mal_id)
    ).length;

    if (availableCount >= needed) {
        return;
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
        const batch = await fetchDistractorBatch([
            ...excludeIds,
            ...state.distractorCache.map((anime) => anime.mal_id)
        ]);

        if (batch.length === 0) {
            continue;
        }

        state.distractorCache.push(...batch);
        pruneDistractorCache();

        const refreshedCount = state.distractorCache.filter(
            (anime) => !excludeIds.includes(anime.mal_id)
        ).length;

        if (refreshedCount >= needed) {
            return;
        }
    }
}

async function selectDistractors(correctAnime, count = CONFIG.OPTIONS_COUNT - 1) {
    const excludeIds = [correctAnime.mal_id];
    await ensureDistractorCache(excludeIds, count);

    const usedTitles = new Set([normalizeTitle(getPrimaryTitle(correctAnime))]);
    const selected = [];

    for (const anime of shuffleArray(state.distractorCache)) {
        const titleKey = normalizeTitle(getPrimaryTitle(anime));
        if (
            anime.mal_id === correctAnime.mal_id ||
            usedTitles.has(titleKey) ||
            selected.some((item) => item.mal_id === anime.mal_id)
        ) {
            continue;
        }

        usedTitles.add(titleKey);
        selected.push(anime);

        if (selected.length >= count) {
            break;
        }
    }

    if (selected.length < count) {
        throw new Error('Could not gather enough answer options from the API.');
    }

    return selected;
}

function loadGameState() {
    try {
        state.xp = parseInt(localStorage.getItem(CONFIG.STORAGE_KEYS.XP), 10) || 0;
        state.streak = parseInt(localStorage.getItem(CONFIG.STORAGE_KEYS.STREAK), 10) || 0;
        state.totalPlayed = parseInt(localStorage.getItem(CONFIG.STORAGE_KEYS.TOTAL_PLAYED), 10) || 0;
        state.bestStreak = parseInt(localStorage.getItem(CONFIG.STORAGE_KEYS.BEST_STREAK), 10) || 0;
    } catch (error) {
        console.warn('Failed to load saved progress:', error);
    }

    updateStatsDisplay();
}

function saveGameState() {
    try {
        localStorage.setItem(CONFIG.STORAGE_KEYS.XP, String(state.xp));
        localStorage.setItem(CONFIG.STORAGE_KEYS.STREAK, String(state.streak));
        localStorage.setItem(CONFIG.STORAGE_KEYS.TOTAL_PLAYED, String(state.totalPlayed));
        localStorage.setItem(CONFIG.STORAGE_KEYS.BEST_STREAK, String(state.bestStreak));
    } catch (error) {
        console.warn('Failed to save progress:', error);
    }
}

function initializeElements() {
    elements.loadingOverlay = document.getElementById('loadingOverlay');
    elements.gameCard = document.getElementById('gameCard');
    elements.animeImage = document.getElementById('animeImage');
    elements.optionsGrid = document.getElementById('optionsGrid');
    elements.feedbackArea = document.getElementById('feedbackArea');
    elements.nextBtn = document.getElementById('nextBtn');
    elements.telegramBtn = document.getElementById('telegramBtn');
    elements.xpDisplay = document.getElementById('xpDisplay');
    elements.streakDisplay = document.getElementById('streakDisplay');
    elements.totalDisplay = document.getElementById('totalDisplay');
    elements.connectionStatus = document.getElementById('connectionStatus');

    if (elements.telegramBtn) {
        elements.telegramBtn.href = CONFIG.TELEGRAM_CHANNEL;
    }
}

function setConnectionStatus(message = '', type = 'info') {
    if (!elements.connectionStatus) {
        return;
    }

    if (!message) {
        elements.connectionStatus.hidden = true;
        elements.connectionStatus.textContent = '';
        elements.connectionStatus.className = 'status-banner';
        return;
    }

    elements.connectionStatus.hidden = false;
    elements.connectionStatus.textContent = message;
    elements.connectionStatus.className = `status-banner ${type}`;
}

function updateConnectionStatus() {
    if (state.isOffline) {
        setConnectionStatus('You are offline. Reconnect to load a new anime round.', 'warning');
        return;
    }

    setConnectionStatus('');
}

function showLoading(show) {
    state.isLoading = show;

    if (!elements.loadingOverlay) {
        return;
    }

    elements.loadingOverlay.classList.toggle('hidden', !show);
}

function updateStatsDisplay() {
    if (elements.xpDisplay) {
        elements.xpDisplay.textContent = formatNumber(state.xp);
    }

    if (elements.streakDisplay) {
        elements.streakDisplay.textContent = String(state.streak);
    }

    if (elements.totalDisplay) {
        elements.totalDisplay.textContent = String(state.totalPlayed);
    }
}

function getPrefetchedAnimeIds() {
    return state.prefetchedRounds
        .map((round) => round?.anime?.mal_id)
        .filter(Boolean);
}

function getExcludedAnimeIds(extraIds = []) {
    return [...new Set([
        ...state.recentAnimeIds,
        ...getPrefetchedAnimeIds(),
        state.currentAnime?.mal_id,
        ...extraIds
    ].filter(Boolean))];
}

function calculateXpEarned() {
    let xp = CONFIG.XP_PER_CORRECT;

    if (state.streak > 0) {
        xp += Math.min(CONFIG.XP_STREAK_BONUS * state.streak, CONFIG.MAX_STREAK_BONUS);
    }

    return xp;
}

function clearRoundUi() {
    state.answerSubmitted = false;
    state.currentOptions = [];
    state.currentImageCandidates = [];
    state.currentAnime = null;

    if (elements.feedbackArea) {
        elements.feedbackArea.innerHTML = '';
    }

    if (elements.optionsGrid) {
        elements.optionsGrid.innerHTML = '';
    }

    if (elements.nextBtn) {
        elements.nextBtn.disabled = true;
    }

    if (elements.animeImage) {
        elements.animeImage.classList.remove('loaded');
        elements.animeImage.removeAttribute('src');
        elements.animeImage.alt = 'Anime screenshot';
    }
}

function warmRoundImage(round) {
    const previewUrl = round?.imageCandidates?.[0];
    if (!previewUrl) {
        return;
    }

    const image = new Image();
    image.decoding = 'async';
    image.src = previewUrl;
}

function renderInlineMessage({ type = 'info', text, actionLabel, onAction }) {
    if (!elements.feedbackArea) {
        return;
    }

    const message = document.createElement('div');
    message.className = `feedback-message ${type}`;
    message.innerHTML = `<span>${escapeHtml(text)}</span>`;

    if (actionLabel && typeof onAction === 'function') {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'feedback-action';
        button.textContent = actionLabel;
        button.addEventListener('click', onAction);
        message.appendChild(button);
    }

    elements.feedbackArea.innerHTML = '';
    elements.feedbackArea.appendChild(message);
}

function createOptionButton(anime, index, isCorrect) {
    const letters = ['A', 'B', 'C', 'D'];
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'option-btn';
    button.dataset.animeId = String(anime.mal_id);
    button.dataset.isCorrect = String(isCorrect);
    button.disabled = state.answerSubmitted;
    button.setAttribute('aria-label', `${letters[index]}: ${getPrimaryTitle(anime)}`);

    button.innerHTML = `
        <span class="option-letter">${letters[index]}</span>
        <span class="option-text">${escapeHtml(getPrimaryTitle(anime))}</span>
    `;

    button.addEventListener('click', () => handleAnswer(button, isCorrect));
    return button;
}

function displayOptions(anime, distractors) {
    const options = shuffleArray([...distractors.slice(0, CONFIG.OPTIONS_COUNT - 1), anime]);
    state.currentOptions = options;

    if (!elements.optionsGrid) {
        return;
    }

    elements.optionsGrid.innerHTML = '';
    options.forEach((option, index) => {
        const button = createOptionButton(option, index, option.mal_id === anime.mal_id);
        elements.optionsGrid.appendChild(button);
    });
}

function showFeedback(selectedButton, isCorrect, correctAnime) {
    const title = getPrimaryTitle(correctAnime);
    const xpEarned = isCorrect ? calculateXpEarned() : 0;

    if (isCorrect) {
        renderInlineMessage({
            type: 'correct',
            text: `Correct! It was ${title}. +${xpEarned} XP`
        });
    } else {
        renderInlineMessage({
            type: 'incorrect',
            text: `Wrong! It was ${title}.`
        });
    }

    const buttons = elements.optionsGrid?.querySelectorAll('.option-btn') || [];
    buttons.forEach((button) => {
        button.disabled = true;
        const isButtonCorrect = Number(button.dataset.animeId) === correctAnime.mal_id;

        if (isButtonCorrect) {
            button.classList.add('correct');
        } else if (button === selectedButton) {
            button.classList.add('incorrect');
        }
    });
}

function handleAnswer(button, isCorrect) {
    if (state.answerSubmitted || !state.currentAnime) {
        return;
    }

    state.answerSubmitted = true;
    state.totalPlayed += 1;

    if (isCorrect) {
        state.streak += 1;
        state.xp += calculateXpEarned();
        if (state.streak > state.bestStreak) {
            state.bestStreak = state.streak;
        }
    } else {
        state.streak = 0;
    }

    saveGameState();
    updateStatsDisplay();
    showFeedback(button, isCorrect, state.currentAnime);

    if (elements.nextBtn) {
        elements.nextBtn.disabled = false;
    }

    scheduleBackgroundPrefetch();

    if (state.telegram?.HapticFeedback) {
        if (isCorrect) {
            state.telegram.HapticFeedback.notificationOccurred('success');
        } else {
            state.telegram.HapticFeedback.notificationOccurred('error');
        }
    }
}

function setViewportHeight() {
    const height = state.telegram?.viewportHeight || window.innerHeight;
    document.documentElement.style.setProperty('--app-height', `${height}px`);
}

function applyTelegramTheme() {
    if (!state.telegram?.themeParams) {
        document.body.classList.remove('is-telegram-mini-app');
        return;
    }

    document.body.classList.add('is-telegram-mini-app');

    const theme = state.telegram.themeParams;
    if (theme.bg_color) {
        document.documentElement.style.setProperty('--tg-bg-color', theme.bg_color);
    }

    if (theme.secondary_bg_color) {
        document.documentElement.style.setProperty('--tg-surface-color', theme.secondary_bg_color);
    }

    if (theme.text_color) {
        document.documentElement.style.setProperty('--tg-text-color', theme.text_color);
    }
}

function initializeTelegramApp() {
    const telegram = window.Telegram?.WebApp;
    if (!telegram) {
        setViewportHeight();
        return;
    }

    state.telegram = telegram;

    try {
        telegram.ready();
        telegram.expand();
        if (typeof telegram.disableVerticalSwipes === 'function') {
            telegram.disableVerticalSwipes();
        }
        if (typeof telegram.setBackgroundColor === 'function') {
            telegram.setBackgroundColor('#0d0d14');
        }
        if (typeof telegram.setHeaderColor === 'function') {
            telegram.setHeaderColor('#161622');
        }
    } catch (error) {
        console.warn('Telegram WebApp initialization failed:', error);
    }

    applyTelegramTheme();
    setViewportHeight();
    telegram.onEvent('themeChanged', applyTelegramTheme);
    telegram.onEvent('viewportChanged', setViewportHeight);
}

function createParticles() {
    const container = document.getElementById('particles');
    if (!container || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        return;
    }

    container.innerHTML = '';
    const particleCount = window.innerWidth < 640 ? 12 : 22;

    for (let i = 0; i < particleCount; i += 1) {
        const particle = document.createElement('span');
        particle.className = 'particle';
        particle.style.left = `${Math.random() * 100}%`;
        particle.style.animationDuration = `${14 + Math.random() * 10}s`;
        particle.style.animationDelay = `${Math.random() * 8}s`;
        particle.style.setProperty('--tx', `${(Math.random() - 0.5) * 200}px`);
        container.appendChild(particle);
    }
}

async function loadImageWithFallback(imageCandidates, altText) {
    if (!elements.animeImage || imageCandidates.length === 0) {
        throw new Error('No image candidates available for this round.');
    }

    for (const imageUrl of imageCandidates) {
        const didLoad = await new Promise((resolve) => {
            elements.animeImage.onload = () => resolve(true);
            elements.animeImage.onerror = () => resolve(false);
            elements.animeImage.src = imageUrl;
            elements.animeImage.alt = altText;
        });

        if (didLoad) {
            elements.animeImage.classList.add('loaded');
            return;
        }
    }

    throw new Error('All image sources failed to load.');
}

async function buildRound() {
    const excludedIds = getExcludedAnimeIds();

    for (let attempt = 1; attempt <= CONFIG.MAX_ROUND_ATTEMPTS; attempt += 1) {
        try {
            const anime = await fetchRandomAnime();

            if (!isAnimePlayable(anime, excludedIds)) {
                continue;
            }

            const pictures = await fetchAnimePictures(anime.mal_id);
            const imageCandidates = extractImageCandidates(anime, pictures);
            if (imageCandidates.length === 0) {
                continue;
            }

            const distractors = await selectDistractors(anime);
            return {
                anime,
                distractors,
                imageCandidates
            };
        } catch (error) {
            console.warn(`Round attempt ${attempt} failed:`, error.message);
        }
    }

    throw new Error('Unable to build a playable round right now.');
}

async function fillPrefetchQueue() {
    if (state.prefetchPromise || state.isOffline) {
        return state.prefetchPromise;
    }

    state.prefetchPromise = (async () => {
        while (state.prefetchedRounds.length < CONFIG.PREFETCH_QUEUE_TARGET) {
            try {
                const round = await buildRound();
                const roundAnimeId = round?.anime?.mal_id;

                if (!roundAnimeId) {
                    break;
                }

                if (getExcludedAnimeIds().includes(roundAnimeId)) {
                    continue;
                }

                state.prefetchedRounds.push(round);
                warmRoundImage(round);
            } catch (error) {
                console.warn('Background prefetch failed:', error.message);
                break;
            }
        }
    })();

    try {
        await state.prefetchPromise;
    } finally {
        state.prefetchPromise = null;
    }
}

function scheduleBackgroundPrefetch() {
    if (state.prefetchScheduled || state.isOffline) {
        return;
    }

    state.prefetchScheduled = true;
    runWhenIdle(async () => {
        state.prefetchScheduled = false;
        await fillPrefetchQueue();
    });
}

async function getNextRound() {
    if (state.prefetchedRounds.length > 0) {
        const nextRound = state.prefetchedRounds.shift();
        scheduleBackgroundPrefetch();
        return nextRound;
    }

    if (state.prefetchPromise) {
        await state.prefetchPromise;
        if (state.prefetchedRounds.length > 0) {
            const nextRound = state.prefetchedRounds.shift();
            scheduleBackgroundPrefetch();
            return nextRound;
        }
    }

    const round = await buildRound();
    scheduleBackgroundPrefetch();
    return round;
}

async function loadNextAnime() {
    if (state.isLoading) {
        return;
    }

    if (state.isOffline) {
        renderInlineMessage({
            type: 'warning',
            text: 'You are offline. Reconnect and try again.',
            actionLabel: 'Retry',
            onAction: () => {
                if (!state.isLoading) {
                    loadNextAnime();
                }
            }
        });
        return;
    }

    showLoading(true);
    clearRoundUi();

    try {
        const round = await getNextRound();
        state.currentAnime = round.anime;
        state.currentImageCandidates = round.imageCandidates;

        await loadImageWithFallback(
            round.imageCandidates,
            `Screenshot from ${getPrimaryTitle(round.anime)}`
        );

        displayOptions(round.anime, round.distractors);
        clampRecentAnime(round.anime.mal_id);
    } catch (error) {
        console.error('Failed to load next anime round:', error);
        renderInlineMessage({
            type: 'incorrect',
            text: error.message || 'Failed to load anime. Please try again.',
            actionLabel: 'Try Again',
            onAction: () => {
                if (!state.isLoading) {
                    loadNextAnime();
                }
            }
        });
    } finally {
        showLoading(false);
    }
}

function handleNetworkChange() {
    state.isOffline = !navigator.onLine;
    updateConnectionStatus();

    if (!state.isOffline) {
        scheduleBackgroundPrefetch();
    }
}

function setupEventListeners() {
    if (elements.nextBtn) {
        elements.nextBtn.addEventListener('click', () => {
            if (!state.isLoading) {
                loadNextAnime();
            }
        });
    }

    document.addEventListener('keydown', (event) => {
        if (state.isLoading) {
            return;
        }

        if (!state.answerSubmitted) {
            const index = 'ABCD'.indexOf(event.key.toUpperCase());
            if (index >= 0) {
                const buttons = elements.optionsGrid?.querySelectorAll('.option-btn') || [];
                buttons[index]?.click();
                return;
            }
        }

        if ((event.key === 'Enter' || event.key === ' ') && !elements.nextBtn?.disabled) {
            event.preventDefault();
            loadNextAnime();
        }
    });

    window.addEventListener('online', handleNetworkChange);
    window.addEventListener('offline', handleNetworkChange);
    window.addEventListener('resize', setViewportHeight);
}

async function init() {
    initializeElements();
    initializeTelegramApp();
    loadGameState();
    setupEventListeners();
    createParticles();
    updateConnectionStatus();
    await loadNextAnime();
    scheduleBackgroundPrefetch();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

window.AnimeGuess = {
    state,
    loadNextAnime,
    CONFIG
};
