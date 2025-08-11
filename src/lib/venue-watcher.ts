import fs from 'fs';
import path from 'path';
import { loadVenues, type Venue } from './venues.js';

let cachedVenues: Venue[] = [];
let lastModified = 0;

const CSV_PATH = path.join(process.cwd(), 'src/data/venues_master.csv');

export function getVenuesWithHotReload(): Venue[] {
  try {
    const stats = fs.statSync(CSV_PATH);
    const currentModified = stats.mtimeMs;
    
    // Only reload if file has been modified
    if (currentModified !== lastModified || cachedVenues.length === 0) {
      console.log('🔄 Reloading venue data...');
      cachedVenues = loadVenues();
      lastModified = currentModified;
    }
    
    return cachedVenues;
  } catch (error) {
    console.error('Error checking venue file:', error);
    // Return cached data if available, otherwise load fresh
    return cachedVenues.length > 0 ? cachedVenues : loadVenues();
  }
}

// Watch for file changes in development
if (import.meta.env.DEV) {
  try {
    fs.watchFile(CSV_PATH, { interval: 2000 }, (curr, prev) => {
      if (curr.mtime !== prev.mtime) {
        console.log('📊 Venue data updated, triggering reload...');
        cachedVenues = loadVenues();
        lastModified = curr.mtimeMs;
      }
    });
  } catch (error) {
    console.log('File watching not available in this environment');
  }
}