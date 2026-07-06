# Anime Guess 🎮

A fully client-side anime guessing game built with the [Jikan API](https://jikan.moe/). Test your anime knowledge by identifying anime from screenshots!

## Features

- 🎯 **Random Anime Screenshots** - Fetches random anime and their screenshots from Jikan API
- 🧠 **4-Choice Quiz** - Guess the anime from 4 options
- ⚡ **XP System** - Earn XP for correct answers with streak bonuses
- 🔥 **Streak Tracking** - Maintain your streak for bonus XP
- 💾 **Persistent Progress** - Saves your XP, streak, and stats to localStorage
- 🌙 **Dark Anime Theme** - Beautiful purple/cyan gradient UI with particle effects
- 📱 **Fully Responsive** - Works on mobile and desktop
- ⌨️ **Keyboard Support** - Press A/B/C/D to select answers, Enter for next
- 🚀 **No Build Step** - Pure HTML/CSS/JS, runs directly in browser

## Demo

Open `index.html` in your browser to play!

## Jikan API Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `GET /v4/random/anime` | Get a random anime |
| `GET /v4/anime/{id}/pictures` | Get anime screenshots/images |
| `GET /v4/anime` | Search for distractor anime |

## Project Structure

```
anime_guess/
├── index.html      # Main HTML structure
├── style.css       # Dark anime-themed styles
├── script.js       # Game logic & API integration
└── README.md       # This file
```

## Configuration

Edit `script.js` to customize:

```javascript
const CONFIG = {
    XP_PER_CORRECT: 100,        // Base XP per correct answer
    XP_STREAK_BONUS: 50,        // Bonus XP per streak level
    MAX_STREAK_BONUS: 500,      // Maximum streak bonus
    OPTIONS_COUNT: 4,           // Number of answer options
    REQUEST_DELAY: 1000,        // Rate limit delay (ms)
    TELEGRAM_CHANNEL: 'https://t.me/your_channel'  // Your Telegram link
};
```

## API Rate Limits

Jikan API v4 limits:
- **30 requests/minute**
- **2 requests/second** burst

The game includes built-in rate limiting and retry logic.

## Customization

### Change Telegram Channel
Update `CONFIG.TELEGRAM_CHANNEL` in `script.js` with your actual Telegram channel URL.

### Modify Theme Colors
Edit CSS custom properties in `style.css`:
```css
:root {
    --accent-primary: #bb86fc;    -- Main purple
    --accent-secondary: #03dac6;  -- Cyan accent
    --accent-warm: #ff6b9d;       -- Pink accent
    /* ... */
}
```

## Browser Support

- Chrome 80+
- Firefox 75+
- Safari 14+
- Edge 80+

## License

MIT License - Feel free to use and modify!

## Credits

- **Anime Data**: [Jikan API](https://jikan.moe/) (unofficial MyAnimeList API)
- **Fonts**: [Inter](https://fonts.google.com/specimen/Inter) & [Outfit](https://fonts.google.com/specimen/Outfit) via Google Fonts
- **Icons**: Inline SVG