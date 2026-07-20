import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
import { Clock3, ChevronRight, FolderOpen, Heart, ListMusic, MoreHorizontal, Music2, Pause, Play, Plus, RefreshCw, Search, SkipBack, SkipForward, SlidersHorizontal, Trash2, Volume2, X, ExternalLink } from 'lucide-react'
import './styles.css'

type Track = { id: string; name: string; path: string; folder: string }
type BackendSettings = { excess_volume: boolean; ldm: boolean; accent: string; cava: { enabled?: boolean; style?: string }; folders?: string[]; music_dirs?: string[] }
type Snapshot = { library: Track[]; queue: string[]; current: Track | null; position: number; duration: number | null; paused: boolean; stopped: boolean; volume: number; muted: boolean; speed: number; pitch: number; eq: string; favorites: string[]; settings: BackendSettings }
type Page = 'all' | 'recent' | 'favorites' | 'queue'
type ContextState = { track: Track; x: number; y: number } | null

const emptySnapshot: Snapshot = { library: [], queue: [], current: null, position: 0, duration: null, paused: true, stopped: true, volume: 80, muted: false, speed: 1, pitch: 0, eq: 'Default', favorites: [], settings: { excess_volume: false, ldm: false, accent: 'default', cava: {} } }
const hasTauriBridge = () => isTauri() || Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)

function App() {
  // The core snapshot is intentionally kept outside React state. React only owns
  // presentation state; the bridge is the sole source of playback/library truth.
  const domain = useRef<Snapshot>(emptySnapshot)
  const [, repaint] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const [page, setPage] = useState<Page>('all'), [search, setSearch] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false), [queueOpen, setQueueOpen] = useState(true)
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [context, setContext] = useState<ContextState>(null), [status, setStatus] = useState('')
  const view = domain.current
  const tracks = view.library
  const queue = view.queue.map(id => tracks.find(track => track.id === id)).filter(Boolean) as Track[]
  const playing = Boolean(view.current && !view.paused && !view.stopped)

  const hydrate = async () => { const snapshot = await invoke<Snapshot>('snapshot'); domain.current = snapshot; repaint(n => n + 1); return snapshot }
  const command = async (name: string, args?: Record<string, unknown>) => { try { await invoke(name, args); await hydrate() } catch (e) { setError(String(e).replace(/^Error:\s*/, '')); setStatus('') } }

  useEffect(() => {
    const close = () => setContext(null)
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setContext(null); setSettingsOpen(false) }; if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); document.querySelector<HTMLInputElement>('.search input')?.focus() } }
    window.addEventListener('click', close); window.addEventListener('keydown', key)
    return () => { window.removeEventListener('click', close); window.removeEventListener('keydown', key) }
  }, [])

  useEffect(() => {
    if (!hasTauriBridge()) { setLoading(false); setStatus('Browser preview: playback requires the Tauri desktop app.'); return }
    let active = true
    const start = async () => {
      try {
        await hydrate()
        const folders = domain.current.settings.folders || domain.current.settings.music_dirs || []
        await invoke('scan_music_directories', { paths: [...new Set(folders)] })
        if (active) { await hydrate(); setStatus(domain.current.library.length ? `${domain.current.library.length} tracks · scanned just now` : '~/Music is empty — add music or choose another folder') }
      } catch (e) { if (active) setError(`Desktop library scan failed: ${String(e).replace(/^Error:\s*/, '')}`) }
      finally { if (active) setLoading(false) }
    }
    let unlisten: (() => void) | undefined
    listen<Snapshot>('optmusic://state', snapshot => { domain.current = snapshot.payload; repaint(n => n + 1) }).then(fn => { unlisten = fn })
    start()
    return () => { active = false; unlisten?.() }
  }, [])

  const loadLibrary = async () => {
    if (!hasTauriBridge()) { setStatus('Browser preview: playback requires the Tauri desktop app.'); return }
    setLoading(true); setError('')
    try { const folders = domain.current.settings.folders || domain.current.settings.music_dirs || []; await invoke('scan_music_directories', { paths: [...new Set(folders)] }); await hydrate(); setStatus(`${domain.current.library.length} tracks · scanned just now`) }
    catch (e) { setError(`Desktop library scan failed: ${String(e).replace(/^Error:\s*/, '')}`) } finally { setLoading(false) }
  }
  const addFolder = async () => {
    if (!hasTauriBridge()) { setStatus('Browser preview: playback requires the Tauri desktop app.'); return }
    setLoading(true); setError(''); setStatus('')
    try {
      const selected = await open({ directory: true, multiple: false, title: 'Add a music folder' })
      if (typeof selected !== 'string') return
      const folders = domain.current.settings.folders || domain.current.settings.music_dirs || []
      await invoke('scan_music_directories', { paths: [...new Set([...folders, selected])] })
      await hydrate()
      setStatus('Library updated')
    } catch (e) {
      const message = `Could not add music folder: ${String(e).replace(/^Error:\s*/, '')}`
      setError(message)
      setStatus(message)
    } finally { setLoading(false) }
  }
  const play = (track: Track) => { setContext(null); void command('play_track', { id: track.id }) }
  const visible = useMemo(() => { let result = page === 'queue' ? queue : page === 'favorites' ? tracks.filter(t => view.favorites.includes(t.id)) : page === 'recent' ? [...tracks] : [...tracks]; if (search) result = result.filter(t => `${t.name} ${t.path}`.toLowerCase().includes(search.toLowerCase())); return result.sort((a, b) => a.name.localeCompare(b.name)) }, [tracks, queue, page, search, view.favorites])
  const sequence = visible.length ? visible : tracks
  const next = () => void command('next')
  const previous = () => void command('previous')
  const toggle = () => { if (!hasTauriBridge()) { setStatus('Browser preview: playback requires the Tauri desktop app.'); return }; if (!view.current && sequence[0]) play(sequence[0]); else void command('toggle_pause') }
  const format = (n: number) => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`
  const addQueue = (t: Track) => { setContext(null); void command('queue_add', { id: t.id }) }
  const playNext = (t: Track) => { setContext(null); void command('queue_play_next', { id: t.id }) }
  const toggleFavorite = (t: Track) => { setContext(null); void command('toggle_favorite', { id: t.id }) }
  const pageTitle = page === 'all' ? 'All music' : page === 'recent' ? 'Recently added' : page === 'favorites' ? 'Favorites' : 'Queue'
  const folders = view.settings.folders || view.settings.music_dirs || []

  return <div className="app-shell"><header className="topbar"><div className="brand"><span className="brand-mark">o</span><span>optMusic</span><span className="beta">DESKTOP</span></div><div className="top-actions"><button className="icon-button" aria-label="Refresh library" onClick={loadLibrary}><RefreshCw size={16} className={loading ? 'spin' : ''} /></button><button className="icon-button" aria-label="Settings" onClick={() => setSettingsOpen(true)}><SlidersHorizontal size={17} /></button><button className="icon-button" aria-label="More options"><MoreHorizontal size={18} /></button></div></header>
    <div className="workspace"><aside className="sidebar"><div className="side-label">LIBRARY <button className="add-page" aria-label="Add music folder" onClick={addFolder}><Plus size={13} /></button></div><NavItem icon={<ListMusic size={16} />} label="All music" count={tracks.length} active={page === 'all'} onClick={() => setPage('all')} /><NavItem icon={<Clock3 size={16} />} label="Recently added" active={page === 'recent'} onClick={() => setPage('recent')} /><NavItem icon={<Heart size={16} />} label="Favorites" count={view.favorites.length} active={page === 'favorites'} onClick={() => setPage('favorites')} /><div className="side-divider" /><div className="side-label">YOUR SPACE</div><NavItem icon={<Music2 size={16} />} label="Queue" count={queue.length} active={page === 'queue'} onClick={() => { setPage('queue'); setQueueOpen(true) }} /><div className="side-spacer" /><div className="folder-hint"><span>LIBRARY FOLDERS</span><strong>{folders.length + 1} locations</strong></div><button className="folder-button" onClick={addFolder}><FolderOpen size={16} />Add music folder</button><input ref={inputRef} hidden type="file" /></aside>
      <main className="library"><div className="library-head"><div><div className="eyebrow">{page === 'queue' ? 'UP NEXT' : 'YOUR LIBRARY'}</div><h1>{pageTitle}</h1><p>{loading ? 'Scanning your folders…' : status || `${visible.length} of ${tracks.length} tracks`}</p></div><div className="search"><Search size={16} /><input aria-label="Search tracks" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search tracks" /><kbd>⌘K</kbd></div></div>{error && !tracks.length ? <State icon={<FolderOpen size={22} />} title="We couldn't open a music folder" text={error}><button className="primary" onClick={loadLibrary}><RefreshCw size={15} />Try again</button><button className="secondary" onClick={addFolder}>Choose folder</button></State> : loading ? <State icon={<RefreshCw className="spin" size={20} />} title="Scanning your library" text="Looking through your music folders…" /> : !tracks.length ? <State icon={<Music2 size={23} />} title="Your library is ready" text="Add audio to ~/Music, or choose another folder to begin."><button className="primary" onClick={addFolder}><Plus size={16} />Add music folder</button></State> : visible.length ? <TrackList tracks={visible} current={view.current} playing={playing} favorites={view.favorites} play={play} addQueue={addQueue} toggleFavorite={toggleFavorite} onContext={(e, t) => { e.preventDefault(); setContext({ track: t, x: Math.min(e.clientX, window.innerWidth - 235), y: Math.min(e.clientY, window.innerHeight - 220) }) }} /> : <State icon={<Search size={20} />} title="No matching tracks" text="Try another search or change the active filter." />}</main>
      {queueOpen && <aside className="queue-panel"><div className="panel-title"><span>UP NEXT <b>{queue.length}</b></span><button className="close-button" aria-label="Close queue" onClick={() => setQueueOpen(false)}><X size={16} /></button></div>{view.current && <div className="now-playing"><div className="cover"><Music2 size={20} /></div><div><small>NOW PLAYING</small><strong>{view.current.name}</strong></div></div>}<QueueList queue={queue} play={play} remove={t => void command('queue_remove', { id: t.id })} /></aside>}</div>
    <footer className="player"><div className="player-track">{view.current ? <><div className="mini-cover"><Music2 size={15} /></div><div><strong>{view.current.name}</strong><small>Local file</small></div></> : <span className="muted-text">Choose a track to start listening</span>}</div><div className="controls"><div className="control-buttons"><button aria-label="Previous track" onClick={previous}><SkipBack size={18} fill="currentColor" /></button><button className="play-button" aria-label={playing ? 'Pause' : 'Play'} onClick={toggle}>{playing ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}</button><button aria-label="Next track" onClick={next}><SkipForward size={18} fill="currentColor" /></button></div><div className="timeline"><span>{format(view.position)}</span><input aria-label="Seek" type="range" min="0" max={view.duration || 1} step=".1" value={view.position} onChange={e => void command('seek', { seconds: Number(e.target.value) })} /><span>{format(view.duration || 0)}</span></div></div><div className="volume"><Volume2 size={16} /><input aria-label="Volume" type="range" min="0" max={view.settings.excess_volume ? 200 : 100} value={view.volume} onChange={e => void command('set_volume', { volume: Number(e.target.value) })} /><span>{view.volume}%</span></div></footer>
    {context && <ContextMenu state={context} favorite={view.favorites.includes(context.track.id)} play={play} playNext={playNext} addQueue={addQueue} toggleFavorite={toggleFavorite} />} {settingsOpen && <SettingsPanel settings={view.settings} volume={view.volume} folders={folders} addFolder={addFolder} setVolume={v => void command('set_volume', { volume: v })} setEq={eq => void command('set_eq', { eq })} close={() => setSettingsOpen(false)} />}</div>
}

function NavItem({ icon, label, count, active, onClick }: { icon: React.ReactNode; label: string; count?: number; active: boolean; onClick: () => void }) { return <button className={`side-item ${active ? 'active' : ''}`} onClick={onClick}>{icon}{label}{count !== undefined && <span className="count">{count}</span>}</button> }
function State({ icon, title, text, children }: { icon: React.ReactNode; title: string; text: string; children?: React.ReactNode }) { return <div className="state-card"><div className="empty-icon">{icon}</div><h2>{title}</h2><p>{text}</p>{children && <div className="state-actions">{children}</div>}</div> }
function TrackList({ tracks, current, playing, favorites, play, addQueue, toggleFavorite, onContext }: { tracks: Track[]; current: Track | null; playing: boolean; favorites: string[]; play: (t: Track) => void; addQueue: (t: Track) => void; toggleFavorite: (t: Track) => void; onContext: (e: React.MouseEvent, t: Track) => void }) { return <div className="track-list"><div className="list-heading"><span>#</span><span>TRACK</span><span className="hide-mobile">LOCATION</span><span /></div>{tracks.map((t, i) => <TrackRow key={t.id} track={t} index={i} current={current} playing={playing} favorite={favorites.includes(t.id)} play={play} addQueue={addQueue} toggleFavorite={toggleFavorite} onContext={(e: React.MouseEvent) => onContext(e, t)} />)}</div> }
function TrackRow({ track, index, current, playing, favorite, play, addQueue, toggleFavorite, onContext }: any) { return <div className={`track-row ${current?.id === track.id ? 'selected' : ''}`} onDoubleClick={() => play(track)} onContextMenu={onContext}><span className="track-number">{current?.id === track.id && playing ? <span className="playing-bars">▮▮</span> : String(index + 1).padStart(2, '0')}</span><button className="track-title" onClick={() => play(track)}><span>{track.name}</span><small>{track.path}</small></button><span className="track-location hide-mobile">LOCAL FILE</span><button className={`favorite-button ${favorite ? 'liked' : ''}`} aria-label={favorite ? 'Remove favorite' : 'Add favorite'} onClick={() => toggleFavorite(track)}><Heart size={15} fill={favorite ? 'currentColor' : 'none'} /></button><button className="queue-add" aria-label="Add to queue" onClick={() => addQueue(track)}><Plus size={16} /></button></div> }
function QueueList({ queue, play, remove }: { queue: Track[]; play: (t: Track) => void; remove: (t: Track) => void }) { return <div className="queue-list">{queue.map((t, i) => <div className="queue-row" key={t.id}><span>{String(i + 1).padStart(2, '0')}</span><button onClick={() => play(t)}>{t.name}</button><button aria-label={`Remove ${t.name}`} onClick={() => remove(t)}><X size={14} /></button></div>)}{!queue.length && <p className="queue-empty">Add tracks with + to build your queue.</p>}</div> }
function ContextMenu({ state, favorite, play, playNext, addQueue, toggleFavorite }: any) { return <div className="context-menu" style={{ left: state.x, top: state.y }} onClick={e => e.stopPropagation()}><div className="context-heading">{state.track.name}</div><button onClick={() => play(state.track)}><Play size={14} />Play now</button><button onClick={() => playNext(state.track)}><SkipForward size={14} />Play next</button><button onClick={() => addQueue(state.track)}><Plus size={14} />Add to queue</button><button onClick={() => toggleFavorite(state.track)}><Heart size={14} />{favorite ? 'Remove favorite' : 'Add to favorites'}</button><div className="context-rule" /><button onClick={() => hasTauriBridge() && invoke('reveal_in_file_manager', { path: state.track.path })}><ExternalLink size={14} />Reveal in folder</button></div> }
function SettingsPanel({ settings, volume, folders, addFolder, setVolume, setEq, close }: { settings: BackendSettings; volume: number; folders: string[]; addFolder: () => void; setVolume: (v: number) => void; setEq: (eq: string) => void; close: () => void }) { const eq = settings.cava?.style || 'Default'; return <div className="modal-backdrop" onClick={close}><section className="settings-modal" onClick={e => e.stopPropagation()}><div className="modal-head"><div><div className="eyebrow">PREFERENCES</div><h2>Settings</h2></div><button className="close-button" aria-label="Close settings" onClick={close}><X size={18} /></button></div><div className="settings-scroll"><section className="settings-section"><h3>Library</h3><p className="section-note">Folders are managed by the desktop app.</p>{folders.map(f => <div className="folder-entry" key={f}><FolderOpen size={15} /><span title={f}>{f}</span></div>)}<div className="folder-entry"><FolderOpen size={15} /><span>~/Music <em>default</em></span></div><button className="secondary full" onClick={addFolder}><Plus size={15} />Add folder</button></section><section className="settings-section"><h3>Playback</h3><label>Volume <span>{volume}%</span><input type="range" min="0" max={settings.excess_volume ? 200 : 100} value={volume} onChange={e => setVolume(Number(e.target.value))} /></label></section><section className="settings-section"><h3>Audio</h3><label>EQ preset<select value={eq} onChange={e => setEq(e.target.value)}><option>Default</option><option>Flat</option><option>Bass</option><option>Vocal</option><option>Focus</option></select></label><p className="section-note">Audio preferences are controlled by the desktop core.</p></section></div></section></div> }
createRoot(document.getElementById('root')!).render(<App />)
