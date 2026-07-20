use optmusic::controller::{CoreController, Snapshot, TrackDto};
use optmusic::eq::EqPreset;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

type State = Mutex<CoreController>;
fn error(e: impl std::fmt::Display) -> String { e.to_string() }

#[tauri::command]
fn snapshot(state: tauri::State<'_, State>) -> Result<Snapshot, String> { Ok(state.lock().map_err(error)?.snapshot()) }
#[tauri::command]
fn scan_music_directories(paths: Vec<String>, state: tauri::State<'_, State>) -> Result<Vec<TrackDto>, String> {
    let mut core=state.lock().map_err(error)?;
    let tracks=core.scan(Some(paths.into_iter().map(PathBuf::from).collect())).map_err(error)?;
    Ok(tracks.iter().map(TrackDto::from).collect())
}
#[tauri::command]
fn default_music_directory() -> String { optmusic::config::default_music_dir().to_string_lossy().into_owned() }
#[tauri::command]
fn play_track(id: String, state: tauri::State<'_, State>) -> Result<(), String> { state.lock().map_err(error)?.play(&id).map_err(error) }
#[tauri::command]
fn toggle_pause(state: tauri::State<'_, State>) -> Result<bool, String> { state.lock().map_err(error)?.toggle_pause().map_err(error) }
#[tauri::command]
fn next(state: tauri::State<'_, State>) -> Result<(), String> { state.lock().map_err(error)?.next().map_err(error) }
#[tauri::command]
fn previous(state: tauri::State<'_, State>) -> Result<(), String> { state.lock().map_err(error)?.previous().map_err(error) }
#[tauri::command]
fn stop(state: tauri::State<'_, State>) -> Result<(), String> { state.lock().map_err(error)?.stop(); Ok(()) }
#[tauri::command]
fn seek(seconds: f64, state: tauri::State<'_, State>) -> Result<(), String> { state.lock().map_err(error)?.seek(seconds).map_err(error) }
#[tauri::command]
fn set_volume(volume: u8, state: tauri::State<'_, State>) -> Result<(), String> { state.lock().map_err(error)?.set_volume(volume); Ok(()) }
#[tauri::command]
fn set_eq(eq: String, state: tauri::State<'_, State>) -> Result<(), String> { let p=EqPreset::ALL.iter().copied().find(|p|p.label()==eq).ok_or_else(||"unknown EQ preset".to_string())?;state.lock().map_err(error)?.set_eq(p);Ok(()) }
#[tauri::command]
fn queue_add(id: String, state: tauri::State<'_, State>) -> Result<(), String> { state.lock().map_err(error)?.add_queue(&id).map_err(error) }
#[tauri::command]
fn queue_remove(id: String, state: tauri::State<'_, State>) -> Result<(), String> { state.lock().map_err(error)?.remove_queue(&id);Ok(()) }
#[tauri::command]
fn queue_play_next(id: String, state: tauri::State<'_, State>) -> Result<(), String> { state.lock().map_err(error)?.play_next(&id).map_err(error) }
#[tauri::command]
fn toggle_favorite(id: String, state: tauri::State<'_, State>) -> Result<bool, String> { state.lock().map_err(error)?.toggle_favorite(&id).map_err(error) }

// Kept as a compatibility boundary for the existing UI; storage is still config.toml.
#[tauri::command]
fn load_settings(state: tauri::State<'_, State>) -> Result<Value, String> {
    let c = state.lock().map_err(error)?;
    let mut settings: Value = serde_json::from_str(c.desktop_preferences()).map_err(error)?;
    if let Some(object) = settings.as_object_mut() {
        object.insert("folders".into(), json!(c.config.music_dirs));
    }
    Ok(json!({"settings": settings, "favorites": c.config.favorites}))
}
#[tauri::command]
fn save_settings(settings: Value, state: tauri::State<'_, State>) -> Result<(), String> {
    let mut c = state.lock().map_err(error)?;
    let payload = settings.get("settings").unwrap_or(&settings);
    if let Some(folders) = payload.get("folders").and_then(Value::as_array) {
        c.config.music_dirs = folders
            .iter()
            .filter_map(Value::as_str)
            .map(|path| optmusic::config::resolve_music_dir(path))
            .collect::<Result<_, _>>()
            .map_err(error)?;
    }
    let favorites = payload
        .get("favorites")
        .or_else(|| settings.get("favorites"))
        .and_then(Value::as_array);
    if let Some(favorites) = favorites {
        // Favorites are ids, not paths supplied for playback; retain only
        // strings here and let core validation happen on playback operations.
        c.config.favorites = favorites
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect();
    }
    let preferences = serde_json::to_string(payload).map_err(error)?;
    c.set_desktop_preferences(preferences).map_err(error)
}
#[tauri::command]
fn reveal_in_file_manager(path: String, state: tauri::State<'_, State>) -> Result<(), String> { let known=state.lock().map_err(error)?.known_path(&path).map_err(error)?.to_path_buf(); let target=&known; #[cfg(target_os="windows")] std::process::Command::new("explorer").arg("/select,").arg(target).spawn().map_err(error)?; #[cfg(target_os="macos")] std::process::Command::new("open").arg("-R").arg(target).spawn().map_err(error)?; #[cfg(all(unix,not(target_os="macos")))] std::process::Command::new("xdg-open").arg(target.parent().unwrap_or(target)).spawn().map_err(error)?; Ok(()) }

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(unix)]
    unsafe {
        // libmpv expects a C numeric locale for parsing and formatting values.
        libc::setlocale(libc::LC_NUMERIC, b"C\0".as_ptr().cast());
    }

    tauri::Builder::default()
        .manage(Mutex::new(CoreController::new()))
        .setup(|app| {
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_millis(250));
                if let Some(state) = handle.try_state::<State>() {
                    if let Ok(mut core) = state.lock() {
                        let _ = handle.emit("optmusic://state", core.snapshot());
                    }
                }
            });
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![snapshot,scan_music_directories,default_music_directory,play_track,toggle_pause,next,previous,stop,seek,set_volume,set_eq,queue_add,queue_remove,queue_play_next,toggle_favorite,load_settings,save_settings,reveal_in_file_manager])
        .run(tauri::generate_context!())
        .expect("error while running optMusic");
}
