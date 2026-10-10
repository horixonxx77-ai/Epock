# Epock

Your day as 24 hour-coins. School is orange, classes are pink, commutes are blue, sleep is red, and bathroom, shower and meals are pastel brown. The time that's left is gold. Plan your gold each night, and the hours you planned turn striped.

## Install it

Open the app's link in Google Chrome on a computer. Click the install icon at the right end of the address bar, or open ⋮ → **Cast, save, and share** → **Install Epock**. Epock opens in its own window with its own icon, and it works offline.

## Connect Google Calendar

Epock reads Google Calendar through a small "bridge" that you run in your own Google account. Epock → Setup → Google Calendar walks you through it:

1. Open [script.google.com/create](https://script.google.com/create), signed in to the account that has your calendars.
2. Rename the project **Epock bridge**. Replace the code with the code in `bridge/Code.gs` (Setup has a Copy button), then save.
3. Next to **Services**, click **+**, choose **Google Calendar API**, and click **Add**.
4. **Deploy → New deployment**, then the gear → **Web app**. Execute as: **Me**. Who has access: **Anyone**. Click **Deploy**.
5. **Authorize access**. Google warns that it hasn't verified the app, because it's your own script: **Advanced → Go to Epock bridge (unsafe) → Allow**.
6. Copy the **Web app URL** (it ends in `/exec`) into Epock → Setup → Bridge link, then click **Connect**.

Keep the bridge link private: anyone who has it can see your calendar. If it ever leaks, archive that deployment in Apps Script (Deploy → Manage deployments) and make a new one.

## Your data

Settings, picks and logs stay in Chrome on your computer. Use Setup → Your data to download a backup or move Epock to another computer. The bridge only reads your calendars while Epock is open, and it only ever removes events that Epock added.

## Update the app

Upload the changed files to the same GitHub repository. GitHub Pages republishes in about a minute, and the installed app picks up the new version the next time it opens.

## Credits

Typefaces: Source Serif 4 and Inter, both under the SIL Open Font License (see `fonts/`).
