/**
 * Tests the exact logic used in main.js for analyzing Spotify URLs.
 */

async function analyzeSpotifyUrl(url) {
  try {
    const cleanUrl = url.split('?')[0];
    const parts = cleanUrl.split('/');
    const typeIndex = parts.findIndex(p => ['track', 'playlist', 'album', 'artist', 'episode', 'show'].includes(p));
    
    if (typeIndex === -1 || typeIndex >= parts.length - 1) {
      return { error: 'URL de Spotify no válida. Asegúrate de que sea un link de track, playlist o álbum.' };
    }
    
    const spotifyType = parts[typeIndex];
    const spotifyId = parts[typeIndex + 1];

    // Try oEmbed API (works for playlists/albums, not tracks)
    if (spotifyType === 'playlist' || spotifyType === 'album') {
      try {
        const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
        const response = await fetch(oembedUrl);
        
        if (response.ok) {
          const oembedData = await response.json();
          return {
            type: 'spotify-playlist',
            title: oembedData.title || `Spotify ${spotifyType === 'playlist' ? 'Playlist' : 'Album'}`,
            artist: oembedData.author_name || 'Unknown',
            count: 0,
            duration: 0,
            thumbnail: oembedData.thumbnail_url || null,
            id: spotifyId,
            entries: []
          };
        }
      } catch (err) {
        console.warn('oEmbed failed, using fallback:', err.message);
      }
    }

    // Fallback for tracks or if oEmbed fails
    if (spotifyType === 'track') {
      return {
        type: 'spotify-track',
        title: `Spotify Track (${spotifyId})`,
        artist: 'Unknown Artist',
        album: 'Spotify',
        duration: 0,
        thumbnail: null,
        id: spotifyId
      };
    }

    return {
      type: 'spotify-playlist',
      title: `Spotify ${spotifyType.charAt(0).toUpperCase() + spotifyType.slice(1)}`,
      artist: 'Unknown',
      count: 0,
      duration: 0,
      thumbnail: null,
      id: spotifyId,
      entries: []
    };
  } catch (error) {
    return { error: `Error analizando URL de Spotify: ${error.message}` };
  }
}

// ==================== Test Runner ====================

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`${GREEN}  ✓ ${msg}${RESET}`);
    passed++;
  } else {
    console.log(`${RED}  ✗ ${msg}${RESET}`);
    failed++;
  }
}

async function runTests() {
  console.log(`${BOLD}\n🧪 analyzeSpotifyUrl Tests${RESET}\n`);

  // Test 1: Single track
  console.log(`${CYAN}  Test: Track URL${RESET}`);
  const trackResult = await analyzeSpotifyUrl('https://open.spotify.com/track/4cOdK2wGLETKw3Pv6flv4M');
  assert(!trackResult.error, 'No error returned');
  assert(trackResult.type === 'spotify-track', `Type is spotify-track (got ${trackResult.type})`);
  assert(trackResult.id === '4cOdK2wGLETKw3Pv6flv4M', `ID is correct`);
  assert(trackResult.title.includes('4cOdK2wGLETKw3Pv6flv4M'), `Title contains ID (got "${trackResult.title}")`);

  // Test 2: Track with query params
  console.log(`\n${CYAN}  Test: Track URL with query params${RESET}`);
  const trackWithParams = await analyzeSpotifyUrl('https://open.spotify.com/track/4cOdK2wGLETKw3Pv6flv4M?si=abc123&context=spotify:search');
  assert(!trackWithParams.error, 'No error returned');
  assert(trackWithParams.type === 'spotify-track', `Type is spotify-track`);
  assert(trackWithParams.id === '4cOdK2wGLETKw3Pv6flv4M', `ID extracted correctly despite query params`);

  // Test 3: Playlist (oEmbed should work)
  console.log(`\n${CYAN}  Test: Playlist URL (oEmbed)${RESET}`);
  const playlistResult = await analyzeSpotifyUrl('https://open.spotify.com/playlist/5MFN2Ep3ZU2FIQWIXNSLrT');
  assert(!playlistResult.error, 'No error returned');
  assert(playlistResult.type === 'spotify-playlist', `Type is spotify-playlist (got ${playlistResult.type})`);
  assert(playlistResult.title && playlistResult.title !== 'Spotify Playlist', `Has real title from oEmbed (got "${playlistResult.title}")`);
  assert(Array.isArray(playlistResult.entries), 'Has entries array');
  assert(playlistResult.count === 0, 'Count is 0 (oEmbed does not provide track count)');

  // Test 4: Album (oEmbed should work)
  console.log(`\n${CYAN}  Test: Album URL (oEmbed)${RESET}`);
  const albumResult = await analyzeSpotifyUrl('https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3');
  assert(!albumResult.error, 'No error returned');
  assert(albumResult.type === 'spotify-playlist', `Type is spotify-playlist for album (got ${albumResult.type})`);
  assert(albumResult.title && albumResult.title !== 'Spotify Album', `Has real title from oEmbed (got "${albumResult.title}")`);

  // Test 5: Invalid URL
  console.log(`\n${CYAN}  Test: Invalid URL${RESET}`);
  const invalidResult = await analyzeSpotifyUrl('https://example.com/not-spotify');
  assert(invalidResult.error, 'Returns error for non-Spotify URL');

  // Test 6: Malformed Spotify URL
  console.log(`\n${CYAN}  Test: Malformed Spotify URL${RESET}`);
  const malformedResult = await analyzeSpotifyUrl('https://open.spotify.com/');
  assert(malformedResult.error, 'Returns error for malformed URL');

  // Test 7: Artist URL (fallback)
  console.log(`\n${CYAN}  Test: Artist URL (fallback)${RESET}`);
  const artistResult = await analyzeSpotifyUrl('https://open.spotify.com/artist/0TnOYISbd1XYRBk9myaseg');
  assert(!artistResult.error, 'No error returned');
  assert(artistResult.type === 'spotify-playlist', `Type is spotify-playlist for artist`);
  assert(artistResult.id === '0TnOYISbd1XYRBk9myaseg', `Artist ID is correct`);

  // Summary
  console.log(`\n${BOLD}========================================${RESET}`);
  console.log(`${BOLD}  Results${RESET}`);
  console.log(`${BOLD}========================================${RESET}`);
  console.log(`${GREEN}  Passed: ${passed}${RESET}`);
  if (failed > 0) console.log(`${RED}  Failed: ${failed}${RESET}`);
  console.log(`${BOLD}========================================\n${RESET}`);

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.log(`${RED}Fatal: ${err.message}${RESET}`);
  process.exit(1);
});
