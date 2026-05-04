# Jamie vs Cole NBA Playoff Bets

A trust-based NBA playoff betting dashboard for Coleman/Cole and Jamie.

## What it does

- Shows today's NBA games using NBA's live scoreboard JSON.
- Shows moneyline odds using The Odds API `basketball_nba` / `h2h` market.
- Saves shared picks in Firebase Firestore.
- Coleman and Jamie must pick opposite teams for the bet to activate.
- Same-team picks cancel the bet.
- Picks lock at scheduled tipoff.
- Final games auto-grade once NBA marks the game final.
- Ledger starts at Jamie +$11 and Cole -$11.

## Important note about the Odds API key

The key is committed in `api/config.js` because that was requested. If this repository is public, the key is public. You can rotate it later and use a Vercel environment variable named `ODDS_API_KEY` if you change your mind.

## Firebase setup

This project uses the Firebase config already pasted into `src/firebase.js`.

You need to enable Firestore in your Firebase console:

1. Open Firebase console.
2. Select project `nba-playoff-betting`.
3. Go to Firestore Database.
4. Create database.
5. Start in test mode if this is just for you/Jamie.

Suggested open/test rules for now:

```txt
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

This is intentionally open. Do not store anything sensitive.

## Local setup

Install Node.js, then run:

```bash
npm install
npm run dev
```

Open the local Vercel URL that appears in your terminal.

## Vercel deployment

1. Push this folder to GitHub.
2. Create a Vercel account.
3. Import the GitHub repo into Vercel.
4. Deploy.

No environment variable is required because the Odds API key is committed in `api/config.js`.

## Collections used in Firestore

- `picks/{gameId}`: saved game picks
- `ledger/{gameId}`: settled bet results
- `roundOverrides/{gameId}`: optional manual round/value override

## Manual correction

Use the Admin tab if NBA data is delayed or a round is misidentified:

- Manual settlement: paste the Game ID and winning Team ID from a game card.
- Round override: paste a Game ID and choose the correct round/value.

## Known limitations

- NBA playoff round is inferred by date unless overridden.
- Injury data links to the official NBA injury report rather than parsing every player automatically.
- Odds matching uses team-name matching between NBA data and The Odds API data.
