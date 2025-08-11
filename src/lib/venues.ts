import { parse } from 'csv-parse/sync';
import fs from 'fs';
import path from 'path';

export interface Venue {
  name: string;
  location: string;
  address: string;
  venue_type: string;
  capacity: number | null;
  contact_email: string;
  contact_phone: string;
  contact_name: string;
  website: string;
  typical_genres: string;
}

export function loadVenues(): Venue[] {
  const csvPath = path.join(process.cwd(), 'src/data/venues_master.csv');
  const fileContent = fs.readFileSync(csvPath, 'utf8');
  
  const records = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    cast: (value, { column }) => {
      if (column === 'capacity') {
        return value === '' ? null : parseInt(value, 10);
      }
      return value;
    }
  });

  return records as Venue[];
}

export function getUniqueLocations(venues: Venue[]): string[] {
  return [...new Set(venues.map(venue => venue.location).filter(Boolean))].sort();
}

export function getUniqueGenres(venues: Venue[]): string[] {
  const allGenres = venues
    .map(venue => venue.typical_genres)
    .filter(Boolean)
    .flatMap(genres => genres.split(/[;,]/).map(g => g.trim()))
    .filter(genre => genre && genre !== 'All Genres (excl. Hard Rock/Metal/Punk/Rap/Thrash)');
  
  return [...new Set(allGenres)].sort();
}

export function getUniqueVenueTypes(venues: Venue[]): string[] {
  return [...new Set(venues.map(venue => venue.venue_type).filter(Boolean))].sort();
}