import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import fs from 'fs';
import path from 'path';

export interface DiscoveredVenue {
  name: string;
  location: string;
  address: string;
  venue_type: string;
  website: string;
  discovered_from: string;
  discovery_date: string;
  status: 'pending' | 'approved' | 'rejected';
}

export function loadDiscoveredVenues(): DiscoveredVenue[] {
  const csvPath = path.join(process.cwd(), 'src/data/discovered_venues.csv');
  
  try {
    if (!fs.existsSync(csvPath)) {
      return [];
    }
    
    const fileContent = fs.readFileSync(csvPath, 'utf8');
    if (!fileContent.trim()) {
      return [];
    }
    
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true
    });

    return records as DiscoveredVenue[];
  } catch (error) {
    console.error('Error loading discovered venues:', error);
    return [];
  }
}

export function saveDiscoveredVenues(venues: DiscoveredVenue[]): void {
  const csvPath = path.join(process.cwd(), 'src/data/discovered_venues.csv');
  
  try {
    const headers = [
      'name', 'location', 'address', 'venue_type', 'website', 
      'discovered_from', 'discovery_date', 'status'
    ];
    
    const csvContent = stringify(venues, { 
      header: true,
      columns: headers
    });
    
    // Ensure directory exists
    const dir = path.dirname(csvPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(csvPath, csvContent);
  } catch (error) {
    console.error('Error saving discovered venues:', error);
    throw error;
  }
}

export function updateVenueStatus(venueName: string, location: string, status: 'approved' | 'rejected'): boolean {
  try {
    const venues = loadDiscoveredVenues();
    const venueIndex = venues.findIndex(v => 
      v.name.toLowerCase() === venueName.toLowerCase() && 
      v.location.toLowerCase() === location.toLowerCase()
    );
    
    if (venueIndex === -1) {
      return false;
    }
    
    venues[venueIndex].status = status;
    saveDiscoveredVenues(venues);
    return true;
  } catch (error) {
    console.error('Error updating venue status:', error);
    return false;
  }
}

export function getPendingVenues(): DiscoveredVenue[] {
  return loadDiscoveredVenues().filter(venue => venue.status === 'pending');
}

export function getApprovedVenues(): DiscoveredVenue[] {
  return loadDiscoveredVenues().filter(venue => venue.status === 'approved');
}