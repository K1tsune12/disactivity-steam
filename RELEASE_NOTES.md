### What's new
- **Settings menu**: the gear button in the title bar now holds the language, the quest timer, window options and the theme.
- **Portuguese (Brazil)**: new translation. The language can be picked in Settings (Portuguese, English or Spanish) or follow the system.
- **Quest timer options**: 15, 30, 45 or 60 minutes, any length you add (saved in the list), or turned off. When it ends it can send a Windows notification and stop the game, or stop the game and close Disactivity.
- **Timer sound**: a sound plays when the timer ends. Pick one of the Windows sounds or any .wav file.
- **Scheduled close**: close Disactivity after a number of minutes, independent from the games.
- **Hide game windows**: optional, keeps the fake game windows out of the taskbar and Alt+Tab.
- **System tray**: the app has a tray icon, and the close button can send it to the tray instead of quitting.
- **Steam games filter**: a button next to the search shows only the games that run through the Steam library.
- **Automatic updates**: the app now checks this repository for new versions and installs them.

### Fixes
- If Steam rewrites its library files while a game is running (for example when it installs something), the entries the app needs are put back within a minute.
- Opening the app again brings the running window to the front instead of starting a second copy, which could stop the games of the first one.
- Windows notifications show the game name, stay on screen for 7 seconds and work in the portable exe (it adds a Start menu shortcut, which Windows uses to name the notifications).
- Steam is also found through the machine-wide install path when the user registry entry is missing.

### Downloads
- `Disactivity.Steam_<version>_x64-setup.exe`: installer, recommended (receives automatic updates)
- `Disactivity.Steam_<version>_x64_portable.exe`: runs without installing

Version 1.0.0 does not update itself, so download this one manually once. Windows may show a SmartScreen warning because the executables are not signed with a certificate. Click "More info" and then "Run anyway".
