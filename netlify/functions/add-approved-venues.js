const fs = require('fs-extra');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');

const DISCOVERED_VENUES_PATH = path.join(process.cwd(), 'src/data/discovered_venues.csv');
const MAIN_VENUES_PATH = path.join(process.cwd(), 'src/data/venues_master.csv');

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

// Load main venues
const loadMainVenues = () => {
  try {
    if (!fs.existsSync(MAIN_VENUES_PATH)) return [];
    const csvContent = fs.readFileSync(MAIN_VENUES_PATH, 'utf8');
    if (!csvContent.trim()) return [];
    return parse(csvContent, { columns: true, skip_empty_lines: true });
  } catch (error) {
    console.error('Error loading main venues:', error);
    return [];
  }
};

// Get approved venues
const getApprovedVenues = () => {
  return loadDiscoveredVenues().filter(venue => venue.status === 'approved');
};

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }
  
  try {
    const approvedVenues = getApprovedVenues();
    
    if (approvedVenues.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({ 
          message: 'No approved venues to add',
          venuesAdded: 0
        })
      };
    }
    
    // Load existing venues
    const existingVenues = loadMainVenues();
    
    // Create backup
    const backupPath = path.join(process.cwd(), 'src/data/venues_backup_before_additions.csv');
    if (fs.existsSync(MAIN_VENUES_PATH)) {
      fs.copyFileSync(MAIN_VENUES_PATH, backupPath);
    }
    
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
      return {
        statusCode: 200,
        body: JSON.stringify({ 
          message: 'All approved venues already exist in the main directory',
          venuesAdded: 0,
          duplicates: approvedVenues.length
        })
      };
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
    
    // Ensure directory exists
    const dir = path.dirname(MAIN_VENUES_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(MAIN_VENUES_PATH, csvContent);
    
    console.log(`Added ${uniqueNewVenues.length} new venues to main directory`);
    
    return {
      statusCode: 200,
      body: JSON.stringify({ 
        message: `Successfully added ${uniqueNewVenues.length} new venues to the main directory.`,
        venuesAdded: uniqueNewVenues.length,
        duplicates: approvedVenues.length - uniqueNewVenues.length,
        totalVenues: allVenues.length,
        addedVenues: uniqueNewVenues.map(v => ({ name: v.name, location: v.location }))
      })
    };
    
  } catch (error) {
    console.error('Error adding approved venues:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Error adding approved venues',
        message: error.message 
      })
    };
  }
};