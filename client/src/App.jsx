import { useState, useEffect, useCallback } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import './App.css';

const COLORS = ['#a8d5ba', '#ff8a80', '#81d4fa', '#ce93d8', '#ffcc80', '#ffab91'];

function formatDuration(seconds) {
  if (!seconds) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function App() {
  const [playlists, setPlaylists] = useState([]);
  const [currentPlaylist, setCurrentPlaylist] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [downloading, setDownloading] = useState({});
  const [downloadErrors, setDownloadErrors] = useState({});
  const [downloadProgress, setDownloadProgress] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [uploadingToYoto, setUploadingToYoto] = useState(false);
  const [yotoUploadProgress, setYotoUploadProgress] = useState(null);
  const [previewId, setPreviewId] = useState(null);
  const [yotoStatus, setYotoStatus] = useState({ configured: false, checking: true });
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('theme');
    if (saved) return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(t => t === 'dark' ? 'light' : 'dark');
  };

  // Fetch playlists and check Yoto status on mount
  useEffect(() => {
    fetchPlaylists();
    checkYotoStatus();
  }, []);

  const checkYotoStatus = async () => {
    try {
      const res = await fetch('/api/yoto/auth/status');
      const data = await res.json();
      setYotoStatus({ ...data, checking: false });
    } catch (err) {
      setYotoStatus({ configured: false, checking: false, error: true });
    }
  };

  const fetchPlaylists = async () => {
    try {
      const res = await fetch('/api/playlists');
      const data = await res.json();
      setPlaylists(data);
    } catch (err) {
      showToast('Failed to load playlists', 'error');
    }
  };

  const fetchPlaylist = async (id) => {
    try {
      const res = await fetch(`/api/playlists/${id}`);
      const data = await res.json();
      setCurrentPlaylist(data);
    } catch (err) {
      showToast('Failed to load playlist', 'error');
    }
  };

  const createPlaylist = async () => {
    try {
      const res = await fetch('/api/playlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'New Playlist',
          color: COLORS[Math.floor(Math.random() * COLORS.length)]
        })
      });
      const playlist = await res.json();
      setPlaylists([playlist, ...playlists]);
      setCurrentPlaylist({ ...playlist, songs: [] });
      showToast('Playlist created!', 'success');
    } catch (err) {
      showToast('Failed to create playlist', 'error');
    }
  };

  const updatePlaylist = async (id, updates) => {
    try {
      await fetch(`/api/playlists/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      fetchPlaylists();
      if (currentPlaylist?.id === id) {
        setCurrentPlaylist({ ...currentPlaylist, ...updates });
      }
    } catch (err) {
      showToast('Failed to update playlist', 'error');
    }
  };

  const deletePlaylist = async (id) => {
    if (!confirm('Delete this playlist?')) return;
    try {
      await fetch(`/api/playlists/${id}`, { method: 'DELETE' });
      setPlaylists(playlists.filter(p => p.id !== id));
      if (currentPlaylist?.id === id) {
        setCurrentPlaylist(null);
      }
      showToast('Playlist deleted', 'success');
    } catch (err) {
      showToast('Failed to delete playlist', 'error');
    }
  };

  // Search
  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`);
      const data = await res.json();
      setSearchResults(data);
    } catch (err) {
      showToast('Search failed', 'error');
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery.trim()) {
        handleSearch();
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [searchQuery, handleSearch]);

  // Add song to playlist
  const addSongToPlaylist = async (song) => {
    if (!currentPlaylist) {
      showToast('Select a playlist first', 'error');
      return;
    }
    try {
      const res = await fetch(`/api/playlists/${currentPlaylist.id}/songs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(song)
      });
      if (!res.ok) {
        const err = await res.json();
        showToast(err.error || 'Failed to add song', 'error');
        return;
      }
      const newSong = await res.json();
      setCurrentPlaylist({
        ...currentPlaylist,
        songs: [...currentPlaylist.songs, newSong]
      });
      showToast('Song added!', 'success');
    } catch (err) {
      showToast('Failed to add song', 'error');
    }
  };

  // Remove song from playlist
  const removeSong = async (songId) => {
    try {
      await fetch(`/api/playlists/${currentPlaylist.id}/songs/${songId}`, {
        method: 'DELETE'
      });
      setCurrentPlaylist({
        ...currentPlaylist,
        songs: currentPlaylist.songs.filter(s => s.id !== songId)
      });
      // Clear any error for this song
      setDownloadErrors(e => {
        const { [songId]: _, ...rest } = e;
        return rest;
      });
      showToast('Song removed', 'success');
    } catch (err) {
      showToast('Failed to remove song', 'error');
    }
  };

  // Reorder songs
  const handleDragEnd = async (result) => {
    if (!result.destination) return;

    const songs = Array.from(currentPlaylist.songs);
    const [reordered] = songs.splice(result.source.index, 1);
    songs.splice(result.destination.index, 0, reordered);

    setCurrentPlaylist({ ...currentPlaylist, songs });

    try {
      await fetch(`/api/playlists/${currentPlaylist.id}/reorder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ songIds: songs.map(s => s.id) })
      });
    } catch (err) {
      showToast('Failed to reorder', 'error');
      fetchPlaylist(currentPlaylist.id);
    }
  };

  // Download song
  const downloadSong = async (youtubeId, songId) => {
    setDownloading(d => ({ ...d, [youtubeId]: true }));
    setDownloadErrors(e => {
      const { [songId]: _, ...rest } = e;
      return rest;
    });
    try {
      const res = await fetch(`/api/downloads/${youtubeId}`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast(data.cached ? 'Already downloaded' : 'Downloaded!', 'success');
        fetchPlaylist(currentPlaylist.id);
      } else {
        const errorMsg = data.details || data.error || 'Download failed';
        setDownloadErrors(e => ({ ...e, [songId]: errorMsg }));
        showToast('Download failed: ' + errorMsg, 'error');
      }
    } catch (err) {
      const errorMsg = err.message || 'Download failed';
      setDownloadErrors(e => ({ ...e, [songId]: errorMsg }));
      showToast('Download failed', 'error');
    } finally {
      setDownloading(d => ({ ...d, [youtubeId]: false }));
    }
  };

  // Download all songs in playlist with progress
  const downloadAll = async () => {
    if (!currentPlaylist?.songs?.length) return;
    setDownloading(d => ({ ...d, all: true }));
    setDownloadProgress({ current: 0, total: currentPlaylist.songs.length, title: '' });

    const eventSource = new EventSource(`/api/downloads/playlist/${currentPlaylist.id}/stream`);

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'progress') {
        setDownloadProgress({
          current: data.current,
          total: data.total,
          title: data.title
        });
        setDownloading(d => ({ ...d, [data.youtube_id]: true }));
      } else if (data.type === 'complete') {
        setDownloading(d => ({ ...d, [data.youtube_id]: false }));
      } else if (data.type === 'error') {
        const song = currentPlaylist.songs.find(s => s.youtube_id === data.youtube_id);
        if (song) {
          setDownloadErrors(e => ({ ...e, [song.id]: data.error }));
        }
        setDownloading(d => ({ ...d, [data.youtube_id]: false }));
      } else if (data.type === 'done') {
        eventSource.close();
        setDownloading(d => ({ ...d, all: false }));
        setDownloadProgress(null);
        fetchPlaylist(currentPlaylist.id);

        if (data.errors > 0) {
          showToast(`Downloaded ${data.completed} songs, ${data.errors} failed`, 'error');
        } else {
          showToast(`Downloaded ${data.completed} songs`, 'success');
        }
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      setDownloading(d => ({ ...d, all: false }));
      setDownloadProgress(null);
      showToast('Download failed', 'error');
    };
  };

  // Export playlist
  const exportPlaylist = async () => {
    if (!currentPlaylist) return;
    setExporting(true);
    try {
      const res = await fetch(`/api/export/${currentPlaylist.id}`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast(`Exported to ${data.exportPath}`, 'success');
      } else {
        showToast(data.error || 'Export failed', 'error');
      }
    } catch (err) {
      showToast('Export failed', 'error');
    } finally {
      setExporting(false);
    }
  };

  // Upload playlist to Yoto with streaming progress
  const uploadToYoto = async () => {
    if (!currentPlaylist) return;

    // Check all songs are downloaded first
    const notDownloaded = currentPlaylist.songs?.filter(s => !s.file_path);
    if (notDownloaded?.length > 0) {
      showToast(`${notDownloaded.length} songs not downloaded yet`, 'error');
      return;
    }

    setUploadingToYoto(true);
    setYotoUploadProgress({ current: 0, total: currentPlaylist.songs.length, title: '', logs: [] });

    const eventSource = new EventSource(`/api/yoto/upload-playlist/${currentPlaylist.id}/stream`);

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'upload-start') {
        setYotoUploadProgress(p => ({
          ...p,
          current: data.current,
          total: data.total,
          title: data.title,
          logs: [...(p?.logs || []), `Starting: ${data.title}`]
        }));
      } else if (data.type === 'log') {
        setYotoUploadProgress(p => ({
          ...p,
          logs: [...(p?.logs || []), data.message]
        }));
      } else if (data.type === 'upload-complete') {
        setYotoUploadProgress(p => ({
          ...p,
          logs: [...(p?.logs || []), `✓ Completed: ${data.title}`]
        }));
      } else if (data.type === 'upload-error') {
        setYotoUploadProgress(p => ({
          ...p,
          logs: [...(p?.logs || []), `✗ Failed: ${data.title} - ${data.error}`]
        }));
      } else if (data.type === 'error') {
        eventSource.close();
        setYotoUploadProgress(p => ({
          ...p,
          logs: [...(p?.logs || []), `Error: ${data.error}`],
          done: true,
          success: false
        }));
        showToast(data.error || 'Upload failed', 'error');
        setUploadingToYoto(false);
      } else if (data.type === 'done') {
        eventSource.close();
        setYotoUploadProgress(p => ({
          ...p,
          logs: [...(p?.logs || []), `✓ Card created successfully!`],
          done: true,
          success: true,
          uploadedTracks: data.uploadedTracks
        }));
        showToast(`Uploaded ${data.uploadedTracks} tracks to Yoto!`, 'success');
        if (data.errors?.length > 0) {
          showToast(`${data.errors.length} tracks failed`, 'error');
        }
        setUploadingToYoto(false);
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      setYotoUploadProgress(p => ({
        ...p,
        logs: [...(p?.logs || []), 'Connection lost'],
        done: true,
        success: false
      }));
      showToast('Upload to Yoto failed - connection lost', 'error');
      setUploadingToYoto(false);
    };
  };

  const closeYotoProgress = () => {
    setYotoUploadProgress(null);
  };

  // Preview
  const openPreview = (youtubeId, e) => {
    e.stopPropagation();
    setPreviewId(youtubeId);
  };

  const closePreview = () => {
    setPreviewId(null);
  };

  // Toast helper
  const showToast = (message, type = 'info') => {
    const id = Date.now();
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => {
      setToasts(t => t.filter(toast => toast.id !== id));
    }, 4000);
  };

  const totalDuration = currentPlaylist?.songs?.reduce((acc, s) => acc + (s.duration || 0), 0) || 0;

  return (
    <div className="app">
      <header className="header">
        <h1 className="header-title">
          <span className="icon">🎵</span>
          Yoto Playlist Builder
        </h1>
        <div className="header-actions">
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <div className={`yoto-status ${yotoStatus.configured ? 'connected' : 'disconnected'}`} title={yotoStatus.configured ? 'Yoto connected' : 'Yoto not configured'}>
            {yotoStatus.checking ? (
              <span className="spinner" />
            ) : (
              <>
                <span className="yoto-status-dot" />
                <span className="yoto-status-text">
                  {yotoStatus.configured ? 'Yoto' : 'No Yoto'}
                </span>
              </>
            )}
          </div>
          <button className="btn btn-secondary" onClick={createPlaylist}>
            + New Playlist
          </button>
        </div>
      </header>

      <main className="main">
        {/* Sidebar - Playlist list */}
        <aside className="sidebar">
          <div className="sidebar-header">
            <span className="sidebar-title">Playlists</span>
          </div>
          <div className="playlist-list">
            {playlists.length === 0 ? (
              <div className="empty-state">
                <p className="text-muted text-sm">No playlists yet</p>
              </div>
            ) : (
              playlists.map(p => (
                <div
                  key={p.id}
                  className={`playlist-item ${currentPlaylist?.id === p.id ? 'active' : ''}`}
                  style={{ '--playlist-color': p.color }}
                  onClick={() => fetchPlaylist(p.id)}
                >
                  <div className="playlist-item-name">{p.name}</div>
                  <div className="playlist-item-count">{p.song_count || 0} songs</div>
                </div>
              ))
            )}
          </div>
        </aside>

        {/* Main content */}
        <section className="content">
          {!currentPlaylist ? (
            <div className="empty-state" style={{ padding: '80px 20px' }}>
              <div className="empty-state-icon">🎶</div>
              <div className="empty-state-title">Select a playlist</div>
              <div className="empty-state-text">
                Choose a playlist from the sidebar or create a new one to get started
              </div>
            </div>
          ) : (
            <>
              <div className="playlist-header">
                <div className="playlist-info">
                  <input
                    type="text"
                    className="playlist-name-input"
                    value={currentPlaylist.name}
                    onChange={(e) => setCurrentPlaylist({ ...currentPlaylist, name: e.target.value })}
                    onBlur={() => updatePlaylist(currentPlaylist.id, { name: currentPlaylist.name })}
                  />
                  <div className="playlist-meta">
                    <span>{currentPlaylist.songs?.length || 0} songs</span>
                    <span>{formatDuration(totalDuration)}</span>
                  </div>
                  <div className="color-picker">
                    {COLORS.map(color => (
                      <button
                        key={color}
                        className={`color-option ${currentPlaylist.color === color ? 'active' : ''}`}
                        style={{ background: color }}
                        onClick={() => updatePlaylist(currentPlaylist.id, { color })}
                      />
                    ))}
                  </div>
                </div>
                <div className="playlist-actions">
                  <button
                    className="btn btn-secondary"
                    onClick={downloadAll}
                    disabled={downloading.all || !currentPlaylist.songs?.length}
                  >
                    {downloading.all ? (
                      <>
                        <span className="spinner" />
                        {downloadProgress && `${downloadProgress.current}/${downloadProgress.total}`}
                      </>
                    ) : (
                      <>⬇️ Download All</>
                    )}
                  </button>
                  <a
                    className="btn btn-mint"
                    href={`/api/export/download/${currentPlaylist.id}`}
                    download
                    style={{ textDecoration: 'none' }}
                  >
                    📦 Download Zip
                  </a>
                  <button
                    className="btn btn-yoto"
                    onClick={uploadToYoto}
                    disabled={uploadingToYoto || !currentPlaylist.songs?.length}
                    title="Upload directly to Yoto"
                  >
                    {uploadingToYoto ? <span className="spinner" /> : '🎴'} Yoto
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={() => deletePlaylist(currentPlaylist.id)}
                  >
                    🗑️
                  </button>
                </div>
              </div>

              <DragDropContext onDragEnd={handleDragEnd}>
                <Droppable droppableId="songs">
                  {(provided) => (
                    <div
                      className="song-list"
                      {...provided.droppableProps}
                      ref={provided.innerRef}
                    >
                      {currentPlaylist.songs?.length === 0 ? (
                        <div className="empty-state" style={{ padding: '40px 20px' }}>
                          <div className="empty-state-text">
                            Search for songs on the right to add them here
                          </div>
                        </div>
                      ) : (
                        currentPlaylist.songs?.map((song, index) => (
                          <Draggable key={song.id} draggableId={song.id} index={index}>
                            {(provided, snapshot) => (
                              <div
                                className={`song-item ${snapshot.isDragging ? 'dragging' : ''} ${downloadErrors[song.id] ? 'has-error' : ''}`}
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                              >
                                <div className="song-drag-handle" {...provided.dragHandleProps}>
                                  ⋮⋮
                                </div>
                                <div className="song-thumbnail-wrapper">
                                  {song.thumbnail ? (
                                    <img src={song.thumbnail} alt="" className="song-thumbnail" />
                                  ) : (
                                    <div className="song-thumbnail" />
                                  )}
                                  <button
                                    className="preview-btn"
                                    onClick={(e) => openPreview(song.youtube_id, e)}
                                    title="Preview"
                                  >
                                    ▶
                                  </button>
                                </div>
                                <div className="song-info">
                                  <div className="song-title">{song.title}</div>
                                  <div className="song-artist">{song.artist}</div>
                                  {downloadErrors[song.id] && (
                                    <div className="song-error" title={downloadErrors[song.id]}>
                                      ⚠️ {downloadErrors[song.id].substring(0, 50)}...
                                    </div>
                                  )}
                                </div>
                                <div className="song-duration">{formatDuration(song.duration)}</div>

                                {/* Always visible status/download section */}
                                <div className="song-download-status">
                                  {downloading[song.youtube_id] ? (
                                    <span className="spinner" />
                                  ) : song.file_path ? (
                                    <span className="status-icon downloaded" title="Downloaded">✓</span>
                                  ) : downloadErrors[song.id] ? (
                                    <button
                                      className="btn btn-sm btn-error"
                                      onClick={() => downloadSong(song.youtube_id, song.id)}
                                      title="Retry download"
                                    >
                                      ↻
                                    </button>
                                  ) : (
                                    <button
                                      className="btn btn-sm btn-ghost"
                                      onClick={() => downloadSong(song.youtube_id, song.id)}
                                      title="Download"
                                    >
                                      ⬇️
                                    </button>
                                  )}
                                </div>

                                <button
                                  className="btn btn-ghost btn-remove"
                                  onClick={() => removeSong(song.id)}
                                  title="Remove"
                                >
                                  ×
                                </button>
                              </div>
                            )}
                          </Draggable>
                        ))
                      )}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </DragDropContext>
            </>
          )}
        </section>

        {/* Search panel */}
        <aside className="search-panel">
          <div className="search-header">
            <div className="search-input-wrapper">
              <span className="search-icon">🔍</span>
              <input
                type="text"
                className="search-input"
                placeholder="Search YouTube..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
          <div className="search-results">
            {isSearching ? (
              <div className="search-loading">
                <span className="spinner" />
              </div>
            ) : searchResults.length === 0 ? (
              <div className="search-empty">
                {searchQuery ? 'No results found' : 'Type to search for songs'}
              </div>
            ) : (
              searchResults.map(result => (
                <div
                  key={result.youtube_id}
                  className="search-result"
                >
                  <div className="search-result-thumb-wrapper">
                    {result.thumbnail ? (
                      <img src={result.thumbnail} alt="" className="search-result-thumb" />
                    ) : (
                      <div className="search-result-thumb" />
                    )}
                    <button
                      className="preview-btn"
                      onClick={(e) => openPreview(result.youtube_id, e)}
                      title="Preview"
                    >
                      ▶
                    </button>
                  </div>
                  <div className="search-result-info" onClick={() => addSongToPlaylist(result)}>
                    <div className="search-result-title">{result.title}</div>
                    <div className="search-result-meta">
                      {result.artist} • {formatDuration(result.duration)}
                    </div>
                  </div>
                  <button
                    className="btn btn-ghost"
                    onClick={() => addSongToPlaylist(result)}
                  >
                    +
                  </button>
                </div>
              ))
            )}
          </div>
        </aside>
      </main>

      {/* Preview Modal */}
      {previewId && (
        <div className="modal-overlay" onClick={closePreview}>
          <div className="preview-modal" onClick={e => e.stopPropagation()}>
            <button className="preview-close" onClick={closePreview}>×</button>
            <iframe
              src={`https://www.youtube.com/embed/${previewId}?autoplay=1`}
              title="Preview"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        </div>
      )}

      {/* Yoto Upload Progress Panel */}
      {yotoUploadProgress && (
        <div className="yoto-progress-panel">
          <div className="yoto-progress-header">
            <span>🎴 Yoto Upload</span>
            {yotoUploadProgress.done && (
              <button className="btn btn-ghost btn-sm" onClick={closeYotoProgress}>×</button>
            )}
          </div>
          {!yotoUploadProgress.done && (
            <div className="yoto-progress-bar-container">
              <div
                className="yoto-progress-bar"
                style={{ width: `${(yotoUploadProgress.current / yotoUploadProgress.total) * 100}%` }}
              />
            </div>
          )}
          <div className="yoto-progress-status">
            {yotoUploadProgress.done
              ? (yotoUploadProgress.success ? '✓ Complete!' : '✗ Failed')
              : `${yotoUploadProgress.current}/${yotoUploadProgress.total}: ${yotoUploadProgress.title}`
            }
          </div>
          <div className="yoto-progress-logs">
            {yotoUploadProgress.logs?.map((log, i) => (
              <div key={i} className={`yoto-log-entry ${log.startsWith('✓') ? 'success' : log.startsWith('✗') ? 'error' : ''}`}>
                {log}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Toasts */}
      <div className="toast-container">
        {toasts.map(toast => (
          <div key={toast.id} className={`toast ${toast.type}`}>
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
