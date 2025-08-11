const fs = require('fs-extra');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');

// Load existing venues from the build
const loadExistingVenues = () => {
  try {
    const csvPath = path.join(process.cwd(), 'src/data/venues_master.csv');
    if (!fs.existsSync(csvPath)) return [];
    const csvContent = fs.readFileSync(csvPath, 'utf8');
    if (!csvContent.trim()) return [];
    return parse(csvContent, { columns: true, skip_empty_lines: true });
  } catch (error) {
    console.error('Error loading existing venues:', error);
    return [];
  }
};

// Validate and normalize venue data
const validateVenue = (venue, rowIndex) => {
  const errors = [];
  const requiredFields = ['name', 'location', 'venue_type'];
  
  // Check required fields
  requiredFields.forEach(field => {
    if (!venue[field] || !venue[field].toString().trim()) {
      errors.push(`Row ${rowIndex + 2}: Missing required field '${field}'`);
    }
  });
  
  // Normalize and validate venue
  const normalizedVenue = {
    name: (venue.name || '').toString().trim(),
    location: (venue.location || '').toString().trim(),
    address: (venue.address || '').toString().trim(),
    venue_type: (venue.venue_type || '').toString().trim(),
    capacity: venue.capacity ? parseInt(venue.capacity) || null : null,
    contact_email: (venue.contact_email || '').toString().trim(),
    contact_phone: (venue.contact_phone || '').toString().trim(),
    contact_name: (venue.contact_name || '').toString().trim(),
    website: (venue.website || '').toString().trim(),
    typical_genres: (venue.typical_genres || '').toString().trim()
  };
  
  // Validate email format if provided
  if (normalizedVenue.contact_email && !normalizedVenue.contact_email.includes('@')) {
    errors.push(`Row ${rowIndex + 2}: Invalid email format`);
  }
  
  // Validate capacity if provided
  if (venue.capacity && (isNaN(venue.capacity) || venue.capacity < 0 || venue.capacity > 1000000)) {
    errors.push(`Row ${rowIndex + 2}: Invalid capacity (should be a number between 0 and 1,000,000)`);
  }
  
  return { venue: normalizedVenue, errors };
};

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }
  
  try {
    const { csvContent } = JSON.parse(event.body);
    
    if (!csvContent || typeof csvContent !== 'string') {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'CSV content is required' })
      };
    }
    
    // Parse the uploaded CSV
    let uploadedVenues;
    try {
      uploadedVenues = parse(csvContent, { 
        columns: true, 
        skip_empty_lines: true,
        trim: true
      });
    } catch (parseError) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          error: 'Invalid CSV format', 
          message: parseError.message 
        })
      };
    }
    
    if (!uploadedVenues.length) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'CSV file is empty or has no valid data rows' })
      };
    }
    
    // Validate all venues
    const validationErrors = [];
    const validVenues = [];
    
    uploadedVenues.forEach((venue, index) => {
      const { venue: normalizedVenue, errors } = validateVenue(venue, index);
      if (errors.length > 0) {
        validationErrors.push(...errors);
      } else {
        validVenues.push(normalizedVenue);
      }
    });
    
    // If there are validation errors, return them
    if (validationErrors.length > 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          error: 'Validation errors in CSV data',
          message: validationErrors.join('; ')
        })
      };
    }
    
    // Load existing venues to check for duplicates
    const existingVenues = loadExistingVenues();
    const existingNames = new Set(existingVenues.map(v => v.name.toLowerCase().trim()));
    
    // Filter out duplicates
    const newVenues = validVenues.filter(venue => 
      !existingNames.has(venue.name.toLowerCase().trim())
    );
    
    const duplicateCount = validVenues.length - newVenues.length;
    
    if (newVenues.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'No new venues to add - all venues already exist in the directory',
          venuesAdded: 0,
          duplicates: duplicateCount,
          totalProcessed: validVenues.length
        })
      };
    }
    
    // Note: In a serverless environment, we can't actually update the CSV file
    // Instead, we'll return the new venues data for manual processing
    // In a real implementation, you'd want to use a database or external storage
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: `Processed ${validVenues.length} venues from CSV. ${newVenues.length} are new.`,
        venuesAdded: newVenues.length,
        duplicates: duplicateCount,
        totalProcessed: validVenues.length,
        // Include the data so it could be manually added
        newVenuesPreview: newVenues.slice(0, 5),
        note: 'In serverless mode, venues cannot be automatically added to the CSV file. Please use the data below to manually update your venues file.',
        csvData: stringify(newVenues, { header: true })
      })
    };
    
  } catch (error) {
    console.error('Error processing CSV upload:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Error processing CSV upload',
        message: error.message
      })
    };
  }
};