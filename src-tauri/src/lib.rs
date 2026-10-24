use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::Manager;

const DISCORD_GAMES_API_URL: &str = "https://discord.com/api/v9/games/detectable";
const DISCORD_NON_GAMES_API_URL: &str = "https://discord.com/api/v9/applications/non-games/detectable";

// v2: the cache now keeps games without executables (Steam mode)
const CACHE_FILE_NAME: &str = "disactivity_games_cache_v2.json";
const FAVORITES_FILE_NAME: &str = "disactivity_favorites.json";
const CACHE_EXPIRY_DAYS: i64 = 2;

// Embedded slave executable bytes (built in release mode)
const SLAVE_EXE: &[u8] = include_bytes!("../slave/target/release/slave.exe");

// Steam library mode: folder created inside the game's install dir, the slave's name
// there, and the file that remembers what was created (see start_steam_game)
const STEAM_SIM_DIR_NAME: &str = "_disactivity";
const STEAM_SIM_EXE_NAME: &str = "DisactivitySim.exe";
const STEAM_SESSIONS_FILE_NAME: &str = "disactivity_steam_sessions.json";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Tracks a running game process
struct RunningGame {
    process: Child,
    temp_dir: PathBuf,
    /// Started in Steam library mode (`temp_dir` is the sim dir inside the install)
    steam: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StartGameResponse {
    pub path: String,
    pub needs_discord_restart: bool,
}

/// State to track all running game processes
struct AppState {
    running_games: Mutex<HashMap<String, RunningGame>>,
    /// Steam library mode installs, by Discord game ID
    steam_installs: Mutex<HashMap<String, SteamInstall>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Executable {
    pub name: String,
    #[serde(default)]
    pub os: Option<String>,
    #[serde(default)]
    pub is_launcher: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ThirdPartySku {
    pub distributor: String,
    #[serde(default)]
    pub id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Game {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub icon_hash: Option<String>,
    #[serde(default)]
    pub executables: Option<Vec<Executable>>,
    pub aliases: Vec<String>,
    #[serde(default)]
    pub third_party_skus: Option<Vec<ThirdPartySku>>,
}

impl Game {
    fn has_executables(&self) -> bool {
        self.executables.as_ref().map_or(false, |execs| !execs.is_empty())
    }

    fn has_steam_sku(&self) -> bool {
        self.third_party_skus.as_ref().map_or(false, |skus| {
            skus.iter().any(|sku| sku.distributor == "steam" && sku.id.is_some())
        })
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct CacheData {
    timestamp: DateTime<Utc>,
    games: Vec<Game>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FetchGamesResponse {
    pub games: Vec<Game>,
    pub from_cache: bool,
}

fn get_cache_path() -> Option<PathBuf> {
    dirs::cache_dir().map(|p| p.join(CACHE_FILE_NAME))
}

fn read_cache() -> Option<CacheData> {
    let cache_path = get_cache_path()?;
    let content = fs::read_to_string(&cache_path).ok()?;
    serde_json::from_str(&content).ok()
}

fn write_cache(games: &[Game]) -> Result<(), String> {
    let cache_path = get_cache_path().ok_or("Could not determine cache directory")?;
    let cache_data = CacheData {
        timestamp: Utc::now(),
        games: games.to_vec(),
    };
    let content = serde_json::to_string(&cache_data).map_err(|e| e.to_string())?;
    fs::write(&cache_path, content).map_err(|e| e.to_string())?;
    Ok(())
}

fn is_cache_valid(cache: &CacheData) -> bool {
    let now = Utc::now();
    let cache_age = now.signed_duration_since(cache.timestamp);
    cache_age.num_days() < CACHE_EXPIRY_DAYS
}

// Favorites functions
fn get_favorites_path() -> Option<PathBuf> {
    dirs::config_dir().map(|p| p.join("disactivity").join(FAVORITES_FILE_NAME))
}

fn read_favorites() -> HashSet<String> {
    let Some(path) = get_favorites_path() else {
        return HashSet::new();
    };

    let Ok(content) = fs::read_to_string(&path) else {
        return HashSet::new();
    };

    serde_json::from_str(&content).unwrap_or_default()
}

fn write_favorites(favorites: &HashSet<String>) -> Result<(), String> {
    let path = get_favorites_path().ok_or("Could not determine config directory")?;

    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let content = serde_json::to_string(favorites).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(())
}

async fn fetch_from_api() -> Result<Vec<Game>, String> {
    let client = reqwest::Client::new();
    let response_games = client
        .get(DISCORD_GAMES_API_URL)
        .header("User-Agent", "DisactivitySteam/1.0.0")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch games: {}", e))?;

    if !response_games.status().is_success() {
        return Err(format!("API returned status: {}", response_games.status()));
    }

    let mut games: Vec<Game> = response_games
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    // Non-games are optional: a failure here must not discard the games list
    match fetch_non_games(&client).await {
        Ok(non_games) => games.extend(non_games),
        Err(e) => eprintln!("Warning: {}", e),
    }

    // Games without executables can still run in Steam mode
    games.retain(|game| game.has_executables() || game.has_steam_sku());
    Ok(games)
}

async fn fetch_non_games(client: &reqwest::Client) -> Result<Vec<Game>, String> {
    let response = client
        .get(DISCORD_NON_GAMES_API_URL)
        .header("User-Agent", "DisactivitySteam/1.0.0")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch non-games: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Non-games API returned status: {}", response.status()));
    }

    response
        .json()
        .await
        .map_err(|e| format!("Failed to parse non-games response: {}", e))
}

#[tauri::command]
async fn fetch_games(force_refresh: bool) -> Result<FetchGamesResponse, String> {
    // Check cache first if not forcing refresh
    if !force_refresh {
        if let Some(cache) = read_cache() {
            if is_cache_valid(&cache) {
                return Ok(FetchGamesResponse {
                    games: cache.games,
                    from_cache: true,
                });
            }
        }
    }

    // Fetch from API
    let games = fetch_from_api().await?;

    // Write to cache
    if let Err(e) = write_cache(&games) {
        eprintln!("Warning: Failed to write cache: {}", e);
    }

    Ok(FetchGamesResponse {
        games,
        from_cache: false,
    })
}

#[tauri::command]
fn get_cache_info() -> Option<String> {
    let cache = read_cache()?;
    Some(cache.timestamp.to_rfc3339())
}

/// Select the best executable for win32 platform
/// Filters by os == "win32", excludes paths starting with ">", prefers the game over
/// its launcher, and then picks the shortest path
fn select_best_executable(executables: &[Executable]) -> Option<String> {
    executables
        .iter()
        .filter(|exe| {
            // Must be win32
            exe.os.as_deref() == Some("win32")
            // Must not start with ">" (which indicates "starts with" pattern)
            && !exe.name.starts_with('>')
        })
        .min_by_key(|exe| {
            // Launchers are not detected as the game, so they go last; then pick the
            // one with fewest path separators, then shortest length
            let separators = exe.name.matches('/').count() + exe.name.matches('\\').count();
            (exe.is_launcher, separators, exe.name.len())
        })
        .map(|exe| exe.name.clone())
}

/// Create the directory structure and place the slave executable
fn setup_game_executable(game_id: &str, exe_path: &str) -> Result<(PathBuf, PathBuf), String> {
    // Get system temp directory
    let temp_base = std::env::temp_dir().join("disactivity").join(game_id);

    // Parse the executable path and create directory structure
    // exe_path might be something like "path/to/game.exe" or just "game.exe"
    let exe_path_normalized = exe_path.replace('\\', "/");
    let path_parts: Vec<&str> = exe_path_normalized.split('/').collect();

    // Create the full path including directories
    let mut full_dir = temp_base.clone();
    for part in &path_parts[..path_parts.len().saturating_sub(1)] {
        if !part.is_empty() {
            full_dir = full_dir.join(part);
        }
    }

    // Create all directories
    fs::create_dir_all(&full_dir).map_err(|e| format!("Failed to create directories: {}", e))?;

    // Get the executable filename
    let exe_filename = path_parts.last().ok_or("Invalid executable path")?;
    let final_exe_path = full_dir.join(exe_filename);

    // Write the slave executable
    fs::write(&final_exe_path, SLAVE_EXE)
        .map_err(|e| format!("Failed to write executable: {}", e))?;

    Ok((temp_base, final_exe_path))
}

/// Clean up a game's temp directory
fn cleanup_game(temp_dir: &PathBuf) -> Result<(), String> {
    if temp_dir.exists() {
        fs::remove_dir_all(temp_dir).map_err(|e| format!("Failed to cleanup: {}", e))?;
    }
    Ok(())
}

// --- Steam library mode ---
//
// Discord links games without registered executables through the Steam library: a
// process running from <library>/steamapps/common/<installdir> is mapped to the Steam
// app via its appmanifest, as long as the app is listed in libraryfolders.vdf, and from
// there to the Discord app via `third_party_skus`. Discord reads that list on startup,
// so it must be restarted after a new app is listed. Neither Steam running nor owning
// the game is required.

/// A game's Steam install used by Steam library mode. A fake one (manifest +
/// libraryfolders.vdf entry) is kept while the game is a favorite or running.
#[derive(Debug, Serialize, Deserialize, Clone)]
struct SteamInstall {
    game_dir: PathBuf,
    /// Fake appmanifest we wrote (None when the game is really installed)
    manifest: Option<PathBuf>,
    /// libraryfolders.vdf and the app ID we added to it
    vdf_entry: Option<(PathBuf, String)>,
    /// Whether we created `game_dir` (then it is removed with the install)
    created_dir: bool,
    favorite: bool,
    running: bool,
}

/// libraryfolders.vdf is shared by every running game, so edits are serialized
static VDF_LOCK: Mutex<()> = Mutex::new(());

/// Steam install folder: the current user's entry first, then the machine-wide one
/// written by the installer (the user entry can be missing, e.g. for another account)
#[cfg(windows)]
fn steam_root() -> Option<PathBuf> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    let from_user = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey("Software\\Valve\\Steam")
        .and_then(|key| key.get_value::<String, _>("SteamPath"));
    let from_machine = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey("SOFTWARE\\WOW6432Node\\Valve\\Steam")
        .and_then(|key| key.get_value::<String, _>("InstallPath"));
    [from_user.ok(), from_machine.ok()]
        .into_iter()
        .flatten()
        .map(PathBuf::from)
        .find(|path| path.join("steamapps").is_dir())
}

#[cfg(not(windows))]
fn steam_root() -> Option<PathBuf> {
    None
}

/// Split a `"key"<tab><tab>"value"` VDF line into (key, value)
fn vdf_pair(line: &str) -> Option<(&str, &str)> {
    let parts: Vec<&str> = line.trim().split('"').collect();
    if parts.len() >= 5 {
        Some((parts[1], parts[3]))
    } else {
        None
    }
}

/// Values of every `"key" "value"` line in a VDF/ACF file
fn vdf_values(content: &str, key: &str) -> Vec<String> {
    content
        .lines()
        .filter_map(vdf_pair)
        .filter(|(k, _)| k.eq_ignore_ascii_case(key))
        .map(|(_, v)| v.replace("\\\\", "\\"))
        .collect()
}

/// Compare Windows paths regardless of slashes and case ("c:/program files (x86)/steam"
/// in the registry vs "C:\\Program Files (x86)\\Steam" in the VDF)
fn normalize_path(path: &str) -> String {
    path.replace("\\\\", "/").replace('\\', "/").trim_end_matches('/').to_lowercase()
}

fn libraryfolders_path() -> Option<PathBuf> {
    Some(steam_root()?.join("steamapps").join("libraryfolders.vdf"))
}

/// All Steam library roots (the folders that contain `steamapps`), main install first
fn steam_libraries() -> Vec<PathBuf> {
    let Some(root) = steam_root() else {
        return Vec::new();
    };
    let mut libraries = vec![root];
    if let Some(content) = libraryfolders_path().and_then(|p| fs::read_to_string(p).ok()) {
        for path in vdf_values(&content, "path") {
            if !libraries.iter().any(|l| normalize_path(&l.to_string_lossy()) == normalize_path(&path)) {
                libraries.push(PathBuf::from(path));
            }
        }
    }
    libraries.retain(|l| l.join("steamapps").is_dir());
    libraries
}

/// Line indexes of the opening and closing braces of the "apps" block of `library`
fn vdf_apps_block(lines: &[&str], library: &Path) -> Option<(usize, usize)> {
    let target = normalize_path(&library.to_string_lossy());
    let path_idx = lines.iter().position(|line| {
        vdf_pair(line).map_or(false, |(k, v)| k == "path" && normalize_path(v) == target)
    })?;
    let apps_idx = path_idx + lines[path_idx..].iter().position(|l| l.trim() == "\"apps\"")?;
    let open_idx = apps_idx + lines[apps_idx..].iter().position(|l| l.trim() == "{")?;
    let close_idx = open_idx + lines[open_idx..].iter().position(|l| l.trim() == "}")?;
    Some((open_idx, close_idx))
}

/// Add the app to the library's "apps" list. Returns false if it was already listed.
fn vdf_add_app(vdf: &Path, library: &Path, app_id: &str) -> Result<bool, String> {
    let _guard = VDF_LOCK.lock().map_err(|e| e.to_string())?;
    let content = fs::read_to_string(vdf)
        .map_err(|e| format!("Failed to read libraryfolders.vdf: {}", e))?;
    let lines: Vec<&str> = content.split('\n').collect();
    let (open_idx, close_idx) = vdf_apps_block(&lines, library)
        .ok_or("Steam library not found in libraryfolders.vdf")?;

    if lines[open_idx..close_idx]
        .iter()
        .any(|l| vdf_pair(l).map_or(false, |(k, _)| k == app_id))
    {
        return Ok(false);
    }

    let entry = format!("\t\t\t\"{}\"\t\t\"0\"", app_id);
    let mut new_lines = lines.clone();
    new_lines.insert(open_idx + 1, &entry);
    fs::write(vdf, new_lines.join("\n"))
        .map_err(|e| format!("Failed to write libraryfolders.vdf: {}", e))?;
    Ok(true)
}

/// Remove an app entry previously added by `vdf_add_app`
fn vdf_remove_app(vdf: &Path, app_id: &str) -> Result<(), String> {
    let _guard = VDF_LOCK.lock().map_err(|e| e.to_string())?;
    let content = fs::read_to_string(vdf).map_err(|e| e.to_string())?;
    let entry = format!("\"{}\"\t\t\"0\"", app_id);
    let mut lines: Vec<&str> = content.split('\n').collect();
    if let Some(idx) = lines.iter().position(|l| l.trim() == entry) {
        lines.remove(idx);
        fs::write(vdf, lines.join("\n")).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Folder name for a fake install, derived from the game name
fn fake_install_dir(game_name: &str, app_id: &str) -> String {
    let name: String = game_name
        .chars()
        .filter(|c| c.is_alphanumeric() || matches!(c, ' ' | '-' | '_' | '.'))
        .collect();
    let name = name.trim().trim_end_matches('.').to_string();
    if name.is_empty() {
        format!("disactivity_{}", app_id)
    } else {
        name
    }
}

fn steam_sessions_path() -> Option<PathBuf> {
    dirs::config_dir().map(|p| p.join("disactivity").join(STEAM_SESSIONS_FILE_NAME))
}

/// Persist the fake installs, so a crash can be cleaned up on next launch
fn save_steam_installs(installs: &HashMap<String, SteamInstall>) {
    let Some(path) = steam_sessions_path() else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(content) = serde_json::to_string(installs) {
        let _ = fs::write(path, content);
    }
}

fn undo_steam_install(install: &SteamInstall) {
    if install.created_dir {
        let _ = cleanup_game(&install.game_dir);
    } else {
        let _ = cleanup_game(&install.game_dir.join(STEAM_SIM_DIR_NAME));
    }
    if let Some(manifest) = &install.manifest {
        let _ = fs::remove_file(manifest);
    }
    if let Some((vdf, app_id)) = &install.vdf_entry {
        let _ = vdf_remove_app(vdf, app_id);
    }
}

/// Undo leftovers from a session that did not stop cleanly (crash, killed app)
fn cleanup_stale_steam_installs() {
    let Some(content) = steam_sessions_path().and_then(|p| fs::read_to_string(p).ok()) else {
        return;
    };
    let installs: HashMap<String, SteamInstall> = serde_json::from_str(&content).unwrap_or_default();
    if !installs.is_empty() {
        let _ = Command::new("taskkill")
            .args(["/IM", STEAM_SIM_EXE_NAME, "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        std::thread::sleep(std::time::Duration::from_millis(500));
        for install in installs.values() {
            undo_steam_install(install);
        }
    }
    save_steam_installs(&HashMap::new());
}

/// Find a real install (or started download) of any of the game's Steam apps
fn find_real_steam_install(libraries: &[PathBuf], steam_app_ids: &[String]) -> Option<PathBuf> {
    steam_app_ids.iter().find_map(|id| {
        libraries.iter().find_map(|library| {
            let steamapps = library.join("steamapps");
            let content =
                fs::read_to_string(steamapps.join(format!("appmanifest_{}.acf", id))).ok()?;
            let installdir = vdf_values(&content, "installdir").into_iter().next()?;
            Some(steamapps.join("common").join(installdir))
        })
    })
}

/// Create the fake install for a game: appmanifest + entry in libraryfolders.vdf.
/// A real install is used as is, without touching Steam's files.
fn create_steam_install(game_name: &str, steam_app_ids: &[String]) -> Result<SteamInstall, String> {
    let libraries = steam_libraries();
    let vdf = libraryfolders_path().filter(|p| p.exists());
    let (Some(main_library), Some(vdf)) = (libraries.first(), vdf) else {
        return Err("Steam is not installed".to_string());
    };
    let app_id = steam_app_ids.first().ok_or("This game has no Steam app ID")?;

    let mut install = SteamInstall {
        game_dir: PathBuf::new(),
        manifest: None,
        vdf_entry: None,
        created_dir: false,
        favorite: false,
        running: false,
    };

    if let Some(dir) = find_real_steam_install(&libraries, steam_app_ids) {
        install.game_dir = dir;
        return Ok(install);
    }

    let installdir = fake_install_dir(game_name, app_id);
    let steamapps = main_library.join("steamapps");
    let manifest = steamapps.join(format!("appmanifest_{}.acf", app_id));
    // StateFlags 4 = fully installed, so Steam does not try to download it
    let content = format!(
        "\"AppState\"\n{{\n\t\"appid\"\t\t\"{}\"\n\t\"universe\"\t\t\"1\"\n\t\"name\"\t\t\"{}\"\n\t\"StateFlags\"\t\t\"4\"\n\t\"installdir\"\t\t\"{}\"\n}}\n",
        app_id,
        game_name.replace('"', ""),
        installdir
    );
    fs::write(&manifest, content).map_err(|e| format!("Failed to write appmanifest: {}", e))?;
    install.manifest = Some(manifest);

    install.game_dir = steamapps.join("common").join(&installdir);
    // Keep a pre-existing folder (e.g. left by an uninstall), only remove ours
    install.created_dir = !install.game_dir.exists();

    match vdf_add_app(&vdf, main_library, app_id) {
        Ok(true) => install.vdf_entry = Some((vdf.clone(), app_id.clone())),
        Ok(false) => {}
        Err(e) => {
            undo_steam_install(&install);
            return Err(e);
        }
    }
    Ok(install)
}

/// Make sure the game has a Steam install, creating a fake one if needed.
/// Returns its directory and whether Discord must be restarted to see it.
fn ensure_steam_install(
    state: &AppState,
    game_id: &str,
    game_name: &str,
    steam_app_ids: &[String],
    mark: impl FnOnce(&mut SteamInstall),
) -> Result<(PathBuf, bool), String> {
    let mut installs = state.steam_installs.lock().map_err(|e| e.to_string())?;
    let newly_listed = match installs.get_mut(game_id) {
        Some(install) => {
            mark(install);
            false
        }
        None => {
            let mut install = create_steam_install(game_name, steam_app_ids)?;
            let newly_listed = install.vdf_entry.is_some();
            mark(&mut install);
            installs.insert(game_id.to_string(), install);
            newly_listed
        }
    };
    let game_dir = installs[game_id].game_dir.clone();
    save_steam_installs(&installs);
    Ok((game_dir, newly_listed))
}

/// Drop one reason to keep the install; undo it when neither favorite nor running
fn release_steam_install(state: &AppState, game_id: &str, unmark: impl FnOnce(&mut SteamInstall)) {
    let Ok(mut installs) = state.steam_installs.lock() else {
        return;
    };
    let Some(install) = installs.get_mut(game_id) else {
        return;
    };
    unmark(install);
    if !install.favorite && !install.running {
        if let Some(install) = installs.remove(game_id) {
            undo_steam_install(&install);
        }
    }
    save_steam_installs(&installs);
}

/// Start the slave from inside the game's Steam install.
/// Returns the running game and whether Discord must be restarted to see it.
fn start_steam_game(
    state: &AppState,
    game_id: &str,
    game_name: &str,
    steam_app_ids: &[String],
) -> Result<(RunningGame, bool), String> {
    let (game_dir, needs_discord_restart) =
        ensure_steam_install(state, game_id, game_name, steam_app_ids, |i| i.running = true)?;

    let sim_dir = game_dir.join(STEAM_SIM_DIR_NAME);
    let exe_path = sim_dir.join(STEAM_SIM_EXE_NAME);
    let process = fs::create_dir_all(&sim_dir)
        .and_then(|_| fs::write(&exe_path, SLAVE_EXE))
        .map_err(|e| format!("Failed to write executable: {}", e))
        .and_then(|_| {
            Command::new(&exe_path)
                .arg(game_name)
                .current_dir(&sim_dir)
                .spawn()
                .map_err(|e| format!("Failed to start process: {}", e))
        });

    match process {
        Ok(process) => Ok((
            RunningGame {
                process,
                temp_dir: sim_dir,
                steam: true,
            },
            needs_discord_restart,
        )),
        Err(e) => {
            let _ = cleanup_game(&sim_dir);
            release_steam_install(state, game_id, |i| i.running = false);
            Err(e)
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct SteamFavorite {
    pub id: String,
    pub name: String,
    pub steam_app_ids: Vec<String>,
}

/// Keep fake installs for favorite Steam-only games while the app is open, so a single
/// Discord restart covers all of them. Returns whether Discord must be restarted.
#[tauri::command(async)]
fn register_steam_favorites(
    games: Vec<SteamFavorite>,
    state: tauri::State<'_, AppState>,
) -> Result<bool, String> {
    let mut needs_discord_restart = false;
    let mut errors = Vec::new();
    for game in &games {
        match ensure_steam_install(&state, &game.id, &game.name, &game.steam_app_ids, |i| {
            i.favorite = true
        }) {
            Ok((_, newly_listed)) => needs_discord_restart |= newly_listed,
            Err(e) => errors.push(format!("{}: {}", game.name, e)),
        }
    }
    if errors.is_empty() {
        Ok(needs_discord_restart)
    } else {
        Err(errors.join("\n"))
    }
}

#[tauri::command]
fn unregister_steam_favorite(game_id: String, state: tauri::State<'_, AppState>) {
    release_steam_install(&state, &game_id, |i| i.favorite = false);
}

/// Restart the Discord desktop client so it rereads the Steam library list
#[tauri::command(async)]
fn restart_discord() -> Result<(), String> {
    let update_exe = dirs::data_local_dir()
        .ok_or("Could not determine local app data directory")?
        .join("Discord")
        .join("Update.exe");
    if !update_exe.exists() {
        return Err("Discord desktop (stable) not found".to_string());
    }

    let _ = Command::new("taskkill")
        .args(["/IM", "Discord.exe", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    std::thread::sleep(std::time::Duration::from_millis(1500));

    Command::new(update_exe)
        .args(["--processStart", "Discord.exe"])
        .spawn()
        .map_err(|e| format!("Failed to start Discord: {}", e))?;
    Ok(())
}

#[tauri::command(async)]
fn start_game(
    game_id: String,
    game_name: String,
    executables: Vec<Executable>,
    selected_executable: Option<String>,
    steam_app_ids: Vec<String>,
    use_steam: bool,
    state: tauri::State<'_, AppState>,
) -> Result<StartGameResponse, String> {
    // Check if game is already running
    {
        let running = state.running_games.lock().map_err(|e| e.to_string())?;
        if running.contains_key(&game_id) {
            return Err("Game is already running".to_string());
        }
    }

    if use_steam {
        let (game, needs_discord_restart) = start_steam_game(&state, &game_id, &game_name, &steam_app_ids)?;
        let path = game.temp_dir.to_string_lossy().to_string();
        let mut running = state.running_games.lock().map_err(|e| e.to_string())?;
        running.insert(game_id, game);
        return Ok(StartGameResponse {
            path,
            needs_discord_restart,
        });
    }

    // Use the selected executable if provided, otherwise auto-select the best one
    let exe_path = if let Some(selected) = selected_executable {
        selected
    } else {
        select_best_executable(&executables)
            .ok_or("No suitable win32 executable found for this game")?
    };

    // Setup the executable in temp directory
    let (temp_dir, final_exe_path) = setup_game_executable(&game_id, &exe_path)?;

    // Start the process
    let process = Command::new(&final_exe_path)
        .spawn()
        .map_err(|e| {
            // Cleanup on failure
            let _ = cleanup_game(&temp_dir);
            format!("Failed to start process: {}", e)
        })?;

    // Store the running game
    let mut running = state.running_games.lock().map_err(|e| e.to_string())?;
    running.insert(
        game_id.clone(),
        RunningGame {
            process,
            temp_dir,
            steam: false,
        },
    );

    Ok(StartGameResponse {
        path: final_exe_path.to_string_lossy().to_string(),
        needs_discord_restart: false,
    })
}

#[tauri::command]
fn stop_game(game_id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut running = state.running_games.lock().map_err(|e| e.to_string())?;

    if let Some(mut game) = running.remove(&game_id) {
        // Kill the process
        let _ = game.process.kill();
        let _ = game.process.wait();

        // Cleanup temp directory
        cleanup_game(&game.temp_dir)?;

        // Steam library mode: drop the fake install unless it is kept as a favorite
        if game.steam {
            release_steam_install(&state, &game_id, |i| i.running = false);
        }
    }

    Ok(())
}

#[tauri::command]
fn get_running_games(state: tauri::State<'_, AppState>) -> Result<Vec<String>, String> {
    let running = state.running_games.lock().map_err(|e| e.to_string())?;
    Ok(running.keys().cloned().collect())
}

#[tauri::command]
fn get_favorites() -> Vec<String> {
    read_favorites().into_iter().collect()
}

#[tauri::command]
fn add_favorite(game_id: String) -> Result<(), String> {
    let mut favorites = read_favorites();
    favorites.insert(game_id);
    write_favorites(&favorites)
}

#[tauri::command]
fn remove_favorite(game_id: String) -> Result<(), String> {
    let mut favorites = read_favorites();
    favorites.remove(&game_id);
    write_favorites(&favorites)
}

#[tauri::command]
fn toggle_favorite(game_id: String) -> Result<bool, String> {
    let mut favorites = read_favorites();
    let is_favorite = if favorites.contains(&game_id) {
        favorites.remove(&game_id);
        false
    } else {
        favorites.insert(game_id);
        true
    };
    write_favorites(&favorites)?;
    Ok(is_favorite)
}

/// Stop all running games and cleanup
fn cleanup_all_games(state: &AppState) {
    if let Ok(mut running) = state.running_games.lock() {
        for (_, mut game) in running.drain() {
            let _ = game.process.kill();
            let _ = game.process.wait();
            let _ = cleanup_game(&game.temp_dir);
        }
    }

    // Undo every Steam library mode install, favorites included
    if let Ok(mut installs) = state.steam_installs.lock() {
        for (_, install) in installs.drain() {
            undo_steam_install(&install);
        }
        save_steam_installs(&installs);
    }

    // Also cleanup the base disactivity temp directory if it exists
    let temp_base = std::env::temp_dir().join("disactivity");
    if temp_base.exists() {
        let _ = fs::remove_dir_all(&temp_base);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // Remember window size, position and maximized state between launches
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(AppState {
            running_games: Mutex::new(HashMap::new()),
            steam_installs: Mutex::new(HashMap::new()),
        })
        .setup(|_app| {
            cleanup_stale_steam_installs();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            fetch_games,
            get_cache_info,
            start_game,
            stop_game,
            get_running_games,
            get_favorites,
            add_favorite,
            remove_favorite,
            toggle_favorite,
            restart_discord,
            register_steam_favorites,
            unregister_steam_favorite
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                // Cleanup all games when window is closed
                if let Some(state) = window.try_state::<AppState>() {
                    cleanup_all_games(state.inner());
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
