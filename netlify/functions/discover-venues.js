import fs from 'fs-extra';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import puppeteer from 'puppeteer';

const DISCOVERED_VENUES_PATH = path.join(process.cwd(), 'src/data/discovered_venues.csv');

// Ensure directories exist
const ensureDataDir = () => {
  const dir = path.dirname(DISCOVERED_VENUES_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

// Initialize discovered venues CSV if it doesn't exist
const initializeDiscoveredVenues = () => {
  ensureDataDir();
  if (!fs.existsSync(DISCOVERED_VENUES_PATH)) {
    const headers = [
      'name', 'location', 'address', 'venue_type', 'website', 
      'discovered_from', 'discovery_date', 'status'
    ];
    const csvContent = stringify([headers]);
    fs.writeFileSync(DISCOVERED_VENUES_PATH, csvContent);
  }
};

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
    const csvContent = stringify(venues, { header: true, columns: headers });
    fs.writeFileSync(DISCOVERED_VENUES_PATH, csvContent);
    console.log(`Saved ${venues.length} discovered venues`);
  } catch (error) {
    console.error('Error saving discovered venues:', error);
    throw error;
  }
};

// Search patterns for different types of venues
const venueSearchTerms = [
  'music venues',
  'concert halls', 
  'live music bars',
  'jazz clubs',
  'blues clubs',
  'rock venues',
  'music clubs',
  'performance spaces',
  'theaters with concerts',
  'breweries with live music',
  'coffee shops with live music'
];

// Discover venues in a city
const discoverVenuesInCity = async (city, maxResults = 25) => {
  console.log(`Starting venue discovery for ${city}...`);
  
  const discoveredVenues = loadDiscoveredVenues();
  const existingVenues = new Set(discoveredVenues.map(v => v.name.toLowerCase() + v.location.toLowerCase()));
  
  let browser;
  const newVenues = [];
  
  try {
    browser = await puppeteer.launch({ 
      headless: 'new',
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--ignore-certificate-errors',
        '--ignore-ssl-errors',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
    
    // Limit search terms for serverless function timeout
    const limitedSearchTerms = venueSearchTerms.slice(0, 6);
    
    for (const searchTerm of limitedSearchTerms) {
      if (newVenues.length >= maxResults) break;
      
      try {
        const query = `${searchTerm} in ${city}`;
        console.log(`Searching: ${query}`);
        
        await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}`, {
          waitUntil: 'networkidle2',
          timeout: 10000
        });
        
        // Wait for results to load
        await page.waitForSelector('[data-content-feature="1"], .g', { timeout: 5000 });
        
        // Extract venue information from search results
        const venues = await page.evaluate((searchTerm, city) => {
          const results = [];
          const elements = document.querySelectorAll('.g, [data-content-feature="1"]');
          
          elements.forEach((element, index) => {
            if (index >= 8) return; // Limit results per search for speed
            
            try {
              const name = element.querySelector('h3')?.textContent?.trim() || 
                          element.querySelector('a')?.textContent?.trim();
              
              const link = element.querySelector('a')?.href;
              
              const snippet = element.textContent?.trim() || '';
              
              // Try to extract address
              let address = '';
              const addressMatch = snippet.match(/\d+[^,]*(?:street|st|avenue|ave|road|rd|drive|dr|blvd|boulevard)[^,]*/i);
              if (addressMatch) {
                address = addressMatch[0].trim();
              }
              
              // Determine venue type
              let venueType = 'Music Venue';
              const content = (name + ' ' + snippet).toLowerCase();
              
              if (content.includes('theater') || content.includes('theatre')) venueType = 'Theater';
              else if (content.includes('club') && content.includes('jazz')) venueType = 'Jazz Club';
              else if (content.includes('club') && content.includes('blues')) venueType = 'Blues Club';  
              else if (content.includes('bar') || content.includes('pub')) venueType = 'Bar/Restaurant';
              else if (content.includes('coffee') || content.includes('cafe')) venueType = 'Coffee Shop';
              else if (content.includes('brewery')) venueType = 'Brewery';
              else if (content.includes('outdoor') || content.includes('amphitheater')) venueType = 'Outdoor Venue';
              else if (content.includes('hall') || content.includes('center')) venueType = 'Concert Hall';
              
              if (!name || !link || name.length < 3) return;
              
              // Filter out non-venue results
              if (content.includes('wikipedia') || 
                  content.includes('ticketmaster') || 
                  content.includes('eventbrite') ||
                  content.includes('facebook.com') ||
                  content.includes('instagram.com') ||
                  name.toLowerCase().includes('event') ||
                  name.toLowerCase().includes('ticket')) {
                return;
              }
              
              results.push({
                name: name.substring(0, 100),
                location: city,
                address: address.substring(0, 200),
                venue_type: venueType,
                website: link,
                discovered_from: searchTerm,
                discovery_date: new Date().toISOString().split('T')[0],
                status: 'pending'
              });
            } catch (error) {
              // Skip invalid results
            }
          });
          
          return results;
        }, searchTerm, city);
        
        // Add unique venues
        venues.forEach(venue => {
          const key = venue.name.toLowerCase() + venue.location.toLowerCase();
          if (!existingVenues.has(key) && newVenues.length < maxResults) {
            existingVenues.add(key);
            newVenues.push(venue);
          }
        });
        
        console.log(`Found ${venues.length} potential venues from "${searchTerm}"`);
        
        // Shorter wait for serverless
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.error(`Error searching for "${searchTerm}":`, error.message);
        continue;
      }
    }
    
  } catch (error) {
    console.error(`Critical error in venue discovery:`, error);
    throw error;
  } finally {
    if (browser) await browser.close();
  }
  
  if (newVenues.length > 0) {
    const allVenues = [...discoveredVenues, ...newVenues];
    saveDiscoveredVenues(allVenues);
    console.log(`Discovery complete! Found ${newVenues.length} new venues in ${city}`);
  } else {
    console.log(`No new venues found in ${city}`);
  }
  
  return newVenues;
};

export const handler = async (event, context) => {
  // Set longer timeout for this function
  context.callbackWaitsForEmptyEventLoop = false;
  
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }
  
  try {
    const { city, maxResults = 25 } = JSON.parse(event.body);
    
    if (!city || typeof city !== 'string') {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'City parameter is required' })
      };
    }
    
    // Initialize data structures
    initializeDiscoveredVenues();
    
    // Run discovery
    const newVenues = await discoverVenuesInCity(city, Math.min(maxResults, 30)); // Limit for timeout
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        message: `Venue discovery completed for ${city}. Found ${newVenues.length} new venues.`,
        venuesFound: newVenues.length,
        venues: newVenues.slice(0, 5) // Return first 5 for preview
      })
    };
    
  } catch (error) {
    console.error('Error in venue discovery:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        error: 'Error discovering venues',
        message: error.message 
      })
    };
  }
};