import type { APIRoute } from 'astro';
import { getApprovedVenues, updateVenueStatus } from '../../lib/discovered-venues';
import { loadVenues } from '../../lib/venues';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import fs from 'fs';
import path from 'path';

export const POST: APIRoute = async ({ request }) => {
  try {
    const approvedVenues = getApprovedVenues();
    
    if (approvedVenues.length === 0) {
      return new Response('No approved venues to add', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' }
      });
    }
    
    // Load existing venues
    const csvPath = path.join(process.cwd(), 'src/data/venues_master.csv');
    const existingVenues = loadVenues();
    
    // Create backup
    const backupPath = path.join(process.cwd(), 'src/data/venues_backup_before_additions.csv');
    fs.copyFileSync(csvPath, backupPath);
    
    // Convert approved venues to main venue format
    const newVenues = approvedVenues.map(venue => ({
      name: venue.name,
      location: venue.location,
      address: venue.address,
      venue_type: venue.venue_type,
      capacity: null, // Will be scraped later
      contact_email: '',
      contact_phone: '',
      contact_name: '',
      website: venue.website,
      typical_genres: ''
    }));
    
    // Check for duplicates
    const existingNames = new Set(existingVenues.map(v => v.name.toLowerCase()));
    const uniqueNewVenues = newVenues.filter(venue => 
      !existingNames.has(venue.name.toLowerCase())
    );
    
    if (uniqueNewVenues.length === 0) {
      return new Response('All approved venues already exist in the main directory', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' }
      });
    }
    
    // Add new venues to main directory
    const allVenues = [...existingVenues, ...uniqueNewVenues];
    
    // Define columns in correct order
    const columns = [
      'name', 'location', 'address', 'venue_type', 'capacity',
      'contact_email', 'contact_phone', 'contact_name', 'website', 'typical_genres'
    ];
    
    const csvContent = stringify(allVenues, {
      header: true,
      columns: columns
    });
    
    fs.writeFileSync(csvPath, csvContent);
    
    // Mark approved venues as processed (you could add a new status or remove them)
    // For now, we'll leave them as approved for tracking purposes
    
    return new Response(`Successfully added ${uniqueNewVenues.length} new venues to the main directory. ${approvedVenues.length - uniqueNewVenues.length} were duplicates.`, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' }
    });
    
  } catch (error) {
    console.error('Error adding approved venues:', error);
    return new Response(`Error adding approved venues: ${error.message}`, {
      status: 500,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
};