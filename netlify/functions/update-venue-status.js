import fs from 'fs-extra';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

const DISCOVERED_VENUES_PATH = path.join(process.cwd(), 'src/data/discovered_venues.csv');

// Load discovered venues
const loadDiscoveredVenues = () => {
  try {
    if (!fs.existsSync(DISCOVERED_VENUES_PATH)) return [];
    const csvContent = fs.readFileSync(DISCOVERED_VENUES_PATH, 'utf8');
    if (!csvContent.trim()) return [];
    return parse(csvContent, { columns: true, skip_empty_lines: true });
  } catch (error) {
    console.error('Error loading discovered venues:', error);
    return [];
  }
};

// Save discovered venues
const saveDiscoveredVenues = (venues) => {
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
    const dir = path.dirname(DISCOVERED_VENUES_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(DISCOVERED_VENUES_PATH, csvContent);
    console.log(`Updated venue statuses for ${venues.length} venues`);
  } catch (error) {
    console.error('Error saving discovered venues:', error);
    throw error;
  }
};

// Update venue status
const updateVenueStatus = (venueName, location, status) => {
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
};

export const handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }
  
  try {
    const { name, location, status } = JSON.parse(event.body);
    
    if (!name || !location || !status) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required parameters' })
      };
    }
    
    if (status !== 'approved' && status !== 'rejected') {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid status. Must be "approved" or "rejected"' })
      };
    }
    
    const success = updateVenueStatus(name, location, status);
    
    if (success) {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          message: `Venue ${status} successfully`,
          venue: { name, location, status }
        })
      };
    } else {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Venue not found' })
      };
    }
    
  } catch (error) {
    console.error('Error updating venue status:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Error updating venue status',
        message: error.message 
      })
    };
  }
};