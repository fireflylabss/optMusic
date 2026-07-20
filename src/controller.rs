//! Core library/player controller shared by desktop clients.
use crate::{
    config::{self, AppConfig},
    eq::EqPreset,
    player::Player,
    playlist::{self, Track},
};
use anyhow::Result;
use serde::Serialize;
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::time::Duration;

#[derive(Debug, Clone, Serialize)]
pub struct TrackDto {
    pub id: String,
    pub name: String,
    pub path: String,
    pub folder: String,
}
impl From<&Track> for TrackDto {
    fn from(t: &Track) -> Self {
        let path = t.path.to_string_lossy().into_owned();
        Self {
            id: path.clone(),
            name: t.display_name(),
            folder: t
                .path
                .parent()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default(),
            path,
        }
    }
}
#[derive(Debug, Clone, Serialize)]
pub struct Snapshot {
    pub library: Vec<TrackDto>,
    pub queue: Vec<String>,
    pub current: Option<TrackDto>,
    pub position: f64,
    pub duration: Option<f64>,
    pub paused: bool,
    pub stopped: bool,
    pub volume: u8,
    pub muted: bool,
    pub speed: f64,
    pub pitch: f64,
    pub eq: String,
    pub favorites: Vec<String>,
    pub settings: AppConfig,
    pub desktop_preferences: String,
}

/// Sole owner of the known library, playback rules, queue and persistence.
pub struct CoreController {
    pub config: AppConfig,
    library: Vec<Track>,
    queue: VecDeque<String>,
    current: Option<String>,
    player: Option<Player>,
    manually_stopped: bool,
    desktop_preferences: String,
}
impl Default for CoreController {
    fn default() -> Self {
        Self::new()
    }
}
impl CoreController {
    pub fn new() -> Self {
        Self::with_config(AppConfig::load())
    }
    pub fn with_config(config: AppConfig) -> Self {
        Self {
            config,
            library: Vec::new(),
            queue: VecDeque::new(),
            current: None,
            player: None,
            manually_stopped: true,
            desktop_preferences: Self::load_desktop_preferences(),
        }
    }
    fn load_desktop_preferences() -> String {
        std::fs::read_to_string(config::config_path())
            .ok()
            .and_then(|raw| toml::from_str::<toml::Value>(&raw).ok())
            .and_then(|doc| {
                doc.get("desktop_preferences")
                    .and_then(|value| value.as_str())
                    .map(str::to_owned)
            })
            .unwrap_or_else(|| "{}".into())
    }
    fn save_config(&self) -> Result<()> {
        self.config.save()?;
        let path = config::config_path();
        let mut table = match toml::from_str::<toml::Value>(&std::fs::read_to_string(&path)?) {
            Ok(toml::Value::Table(table)) => table,
            _ => Default::default(),
        };
        table.insert(
            "desktop_preferences".into(),
            toml::Value::String(self.desktop_preferences.clone()),
        );
        let doc = toml::Value::Table(table);
        std::fs::write(path, toml::to_string_pretty(&doc)?)?;
        Ok(())
    }
    pub fn set_desktop_preferences(&mut self, preferences: String) -> Result<()> {
        self.desktop_preferences = preferences;
        self.save_config()
    }
    pub fn desktop_preferences(&self) -> &str {
        &self.desktop_preferences
    }
    pub fn scan(&mut self, dirs: Option<Vec<PathBuf>>) -> Result<&[Track]> {
        if let Some(dirs) = dirs {
            // A removed folder can remain in the saved desktop configuration.
            // Ignore and prune only missing directories; other resolution errors
            // should still be reported.
            self.config.music_dirs = dirs
                .iter()
                .filter_map(|p| match config::resolve_music_dir(&p.to_string_lossy()) {
                    Ok(path) => Some(Ok(path)),
                    Err(error)
                        if error
                            .to_string()
                            .starts_with("music directory does not exist:") =>
                    {
                        None
                    }
                    Err(error) => Some(Err(error)),
                })
                .collect::<Result<_>>()?;
            self.save_config()?;
        }
        let mut all = Vec::new();
        for d in self
            .config
            .music_dirs
            .iter()
            .chain(std::iter::once(&config::default_music_dir()))
        {
            if d.exists() {
                all.extend(playlist::scan_path(d, true)?);
            }
        }
        all.sort_by(|a, b| a.path.cmp(&b.path));
        all.dedup_by(|a, b| a.path == b.path);
        self.library = all;
        Ok(&self.library)
    }
    fn track(&self, id: &str) -> Result<&Track> {
        self.library
            .iter()
            .find(|t| t.path.to_string_lossy() == id)
            .ok_or_else(|| anyhow::anyhow!("track is not known by core: {id}"))
    }
    fn player(&mut self) -> Result<&mut Player> {
        if self.player.is_none() {
            let mut p = Player::new(100, 1.0, 0.0)?;
            p.set_volume_max(self.config.volume_max());
            self.player = Some(p);
        }
        Ok(self.player.as_mut().unwrap())
    }
    pub fn play(&mut self, id: &str) -> Result<()> {
        let path = self.track(id)?.path.clone();
        self.current = Some(id.into());
        self.manually_stopped = false;
        self.queue.retain(|x| x != id);
        self.player()?.play_file(&path)
    }
    pub fn toggle_pause(&mut self) -> Result<bool> {
        // A pause request before the first play must not boot libmpv or fail just
        // because the desktop has not selected a track yet.
        Ok(match self.player.as_mut() {
            Some(player) => player.toggle_pause(),
            None => true,
        })
    }
    pub fn stop(&mut self) {
        self.manually_stopped = true;
        if let Some(p) = self.player.as_mut() {
            p.stop();
        }
    }
    pub fn next(&mut self) -> Result<()> {
        let id = self.queue.pop_front().or_else(|| self.next_id());
        if let Some(id) = id {
            self.play(&id)
        } else {
            Ok(())
        }
    }
    pub fn previous(&mut self) -> Result<()> {
        if let Some(p) = self.player.as_mut() {
            if !p.is_idle() && p.position() > Duration::from_secs(3) {
                p.seek(Duration::ZERO)?;
                return Ok(());
            }
        }
        let id = self.current.clone();
        if let Some(id) = id {
            let i = self
                .library
                .iter()
                .position(|t| t.path.to_string_lossy() == id)
                .unwrap_or(0);
            let target = if i > 0 {
                match self.library.get(i - 1) {
                    Some(track) => track.path.to_string_lossy().into_owned(),
                    None => id,
                }
            } else {
                id
            };
            self.play(&target)?;
        }
        Ok(())
    }
    fn next_id(&self) -> Option<String> {
        let i = self
            .current
            .as_ref()
            .and_then(|id| {
                self.library
                    .iter()
                    .position(|t| t.path.to_string_lossy() == *id)
            })
            .map(|i| i + 1)
            .unwrap_or(0);
        self.library
            .get(i)
            .map(|t| t.path.to_string_lossy().into_owned())
    }
    pub fn seek(&mut self, s: f64) -> Result<()> {
        self.player()?.seek(Duration::from_secs_f64(s.max(0.0)))
    }
    pub fn set_volume(&mut self, v: u8) {
        if let Ok(p) = self.player() {
            p.set_volume(v);
        }
    }
    pub fn set_eq(&mut self, e: EqPreset) {
        if let Ok(p) = self.player() {
            p.set_eq(e);
        }
    }
    pub fn add_queue(&mut self, id: &str) -> Result<()> {
        self.track(id)?;
        if !self.queue.iter().any(|x| x == id) {
            self.queue.push_back(id.into());
        }
        Ok(())
    }
    pub fn remove_queue(&mut self, id: &str) {
        self.queue.retain(|x| x != id)
    }
    pub fn play_next(&mut self, id: &str) -> Result<()> {
        self.track(id)?;
        self.remove_queue(id);
        self.queue.push_front(id.into());
        Ok(())
    }
    pub fn toggle_favorite(&mut self, id: &str) -> Result<bool> {
        self.track(id)?;
        if let Some(i) = self.config.favorites.iter().position(|x| x == id) {
            self.config.favorites.remove(i);
        } else {
            self.config.favorites.push(id.into());
        };
        self.save_config()?;
        Ok(self.config.favorites.iter().any(|x| x == id))
    }
    pub fn known_path(&self, id: &str) -> Result<&Path> {
        Ok(&self.track(id)?.path)
    }
    pub fn snapshot(&mut self) -> Snapshot {
        self.advance_if_finished();
        let current = self
            .current
            .as_ref()
            .and_then(|id| {
                self.library
                    .iter()
                    .find(|t| t.path.to_string_lossy() == *id)
            })
            .map(TrackDto::from);
        let (position, duration, paused, stopped, volume, muted, speed, pitch, eq) =
            if let Some(p) = self.player.as_mut() {
                (
                    p.position().as_secs_f64(),
                    p.duration().map(|d| d.as_secs_f64()),
                    p.is_paused(),
                    p.is_idle(),
                    p.volume(),
                    p.muted(),
                    p.speed(),
                    p.pitch(),
                    p.eq_label().into(),
                )
            } else {
                (0.0, None, true, true, 100, false, 1.0, 1.0, "off".into())
            };
        Snapshot {
            library: self.library.iter().map(TrackDto::from).collect(),
            queue: self.queue.iter().cloned().collect(),
            current,
            position,
            duration,
            paused,
            stopped,
            volume,
            muted,
            speed,
            pitch,
            eq,
            favorites: self.config.favorites.clone(),
            settings: self.config.clone(),
            desktop_preferences: self.desktop_preferences.clone(),
        }
    }

    /// Poll libmpv and apply the same sequential policy as the terminal UI.
    /// This is called by the Tauri position ticker, so EOF advances even when
    /// the frontend sends no further command.
    fn advance_if_finished(&mut self) {
        let ended = self.player.as_mut().is_some_and(|p| p.is_idle())
            && !self.manually_stopped
            && self.current.is_some();
        if ended {
            let _ = self.next();
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn no_mpv_needed_for_snapshot() {
        let mut c = CoreController::with_config(AppConfig::default());
        assert!(c.snapshot().library.is_empty());
    }
    #[test]
    fn toggle_pause_before_first_play_is_safe() {
        let mut c = CoreController::with_config(AppConfig::default());
        assert!(c.toggle_pause().unwrap());
        assert!(c.snapshot().stopped);
    }
    #[test]
    fn empty_library_is_safe_for_scan_ticker_and_navigation() {
        let mut c = CoreController::with_config(AppConfig::default());
        c.library.clear();
        c.queue.clear();
        assert!(c.next().is_ok());
        assert!(c.previous().is_ok());
        assert!(c.snapshot().library.is_empty());
        // This is the same polling path used by the Tauri position ticker.
        assert!(c.snapshot().library.is_empty());
    }
    #[test]
    fn arbitrary_paths_are_rejected() {
        let mut c = CoreController::with_config(AppConfig::default());
        assert!(c.add_queue("/random.mp3").is_err());
    }
}
