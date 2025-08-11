#!/usr/bin/env node

import fs from 'fs-extra';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DISCOVERED_VENUES_PATH = path.join(__dirname, '../src/data/discovered_venues.csv');
const LOG_PATH = path.join(__dirname, '../logs/discovery.log');

// Ensure directories exist
await fs.ensureDir(path.dirname(DISCOVERED_VENUES_PATH));
await fs.ensureDir(path.dirname(LOG_PATH));

// Initialize discovered venues CSV if it doesn't exist
if (!fs.existsSync(DISCOVERED_VENUES_PATH)) {
  const headers = [
    'name', 'location', 'address', 'venue_type', 'website', 
    'discovered_from', 'discovery_date', 'status'
  ];
  const csvContent = stringify([headers]);
  fs.writeFileSync(DISCOVERED_VENUES_PATH, csvContent);
}

// Logging function
function log(message) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}\n`;
  console.log(logEntry.trim());
  fs.appendFileSync(LOG_PATH, logEntry);
}

// Load discovered venues
function loadDiscoveredVenues() {
  try {
    if (!fs.existsSync(DISCOVERED_VENUES_PATH)) return [];
    const csvContent = fs.readFileSync(DISCOVERED_VENUES_PATH, 'utf8');
    if (!csvContent.trim()) return [];
    return parse(csvContent, { columns: true, skip_empty_lines: true });
  } catch (error) {
    log(`Error loading discovered venues: ${error.message}`);
    return [];
  }
}

// Save discovered venues
function saveDiscoveredVenues(venues) {
  try {
    const headers = [
      'name', 'location', 'address', 'venue_type', 'website', 
      'discovered_from', 'discovery_date', 'status'
    ];
    const csvContent = stringify(venues, { header: true, columns: headers });
    fs.writeFileSync(DISCOVERED_VENUES_PATH, csvContent);
    log(`Saved ${venues.length} discovered venues`);
  } catch (error) {
    log(`Error saving discovered venues: ${error.message}`);
  }
}

// Search patterns for different types of venues
const venueSearchTerms = [
  'music venues',
  'concert halls', 
  'live music bars',
  'nightclubs with live music',
  'performance spaces',
  'theaters with concerts',
  'music clubs',
  'jazz clubs',
  'blues clubs',
  'rock venues',
  'acoustic venues',
  'coffee shops with live music',
  'breweries with live music',
  'outdoor music venues'
];

// Extract venue information from search results
function extractVenueInfo(element, searchTerm, city) {
  try {
    const name = element.querySelector('h3')?.textContent?.trim() || 
                 element.querySelector('[data-attrid="title"]')?.textContent?.trim() || 
                 element.querySelector('a')?.textContent?.trim();
    
    const link = element.querySelector('a')?.href;
    
    // Get snippet/description
    const snippet = element.querySelector('[data-content-feature="1"]')?.textContent?.trim() ||
                   element.querySelector('.VwiC3b')?.textContent?.trim() ||
                   element.querySelector('.s3v9rd')?.textContent?.trim();
    
    // Try to extract address from snippet or other elements
    let address = '';
    if (snippet) {
      // Look for address patterns in snippet
      const addressMatch = snippet.match(/\d+[^,]*(?:street|st|avenue|ave|road|rd|drive|dr|blvd|boulevard)[^,]*/i);
      if (addressMatch) {
        address = addressMatch[0].trim();
      }
    }
    
    // Determine venue type based on search term and content
    let venueType = 'Music Venue';
    const content = (name + ' ' + snippet).toLowerCase();
    
    if (content.includes('theater') || content.includes('theatre')) venueType = 'Theater';
    else if (content.includes('club') && content.includes('jazz')) venueType = 'Jazz Club';
    else if (content.includes('club') && content.includes('blues')) venueType = 'Blues Club';  
    else if (content.includes('bar') || content.includes('pub')) venueType = 'Bar/Restaurant';
    else if (content.includes('coffee') || content.includes('cafe')) venueType = 'Coffee Shop';
    else if (content.includes('brewery') || content.includes('brewpub')) venueType = 'Brewery';
    else if (content.includes('outdoor') || content.includes('amphitheater')) venueType = 'Outdoor Venue';
    else if (content.includes('hall') || content.includes('center')) venueType = 'Concert Hall';
    
    if (!name || !link || name.length < 3) return null;
    
    return {
      name: name.substring(0, 100), // Limit length
      location: city,
      address: address.substring(0, 200),
      venue_type: venueType,
      website: link,
      discovered_from: searchTerm,
      discovery_date: new Date().toISOString().split('T')[0],
      status: 'pending'
    };
  } catch (error) {
    return null;
  }
}

// Discover venues in a city
async function discoverVenuesInCity(city, maxResults = 50) {
  log(`Starting venue discovery for ${city}...`);
  
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
        '--ignore-ssl-errors'
      ]
    });
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
    
    for (const searchTerm of venueSearchTerms) {
      if (newVenues.length >= maxResults) break;
      
      try {
        const query = `${searchTerm} in ${city}`;
        log(`Searching: ${query}`);
        
        await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}`, {
          waitUntil: 'networkidle2',
          timeout: 15000
        });
        
        // Wait for results to load
        await page.waitForSelector('[data-content-feature="1"], .g', { timeout: 5000 });
        
        // Extract venue information from search results
        const venues = await page.evaluate((searchTerm, city) => {
          const results = [];
          const elements = document.querySelectorAll('.g, [data-content-feature="1"]');
          
          elements.forEach((element, index) => {
            if (index >= 10) return; // Limit results per search
            
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
        
        log(`Found ${venues.length} potential venues from "${searchTerm}"`);
        
        // Be respectful - wait between searches
        await new Promise(resolve => setTimeout(resolve, 2000));
        
      } catch (error) {
        log(`Error searching for "${searchTerm}": ${error.message}`);
        continue;
      }
    }
    
  } catch (error) {
    log(`Critical error in venue discovery: ${error.message}`);
  } finally {
    if (browser) await browser.close();
  }
  
  if (newVenues.length > 0) {
    const allVenues = [...discoveredVenues, ...newVenues];
    saveDiscoveredVenues(allVenues);
    log(`Discovery complete! Found ${newVenues.length} new venues in ${city}`);
  } else {
    log(`No new venues found in ${city}`);
  }
  
  return newVenues;
}

// Command line interface
if (process.argv.length < 3) {
  console.log('Usage: node venue-discovery.js <city> [maxResults]');
  console.log('Example: node venue-discovery.js "Raleigh, NC" 25');
  process.exit(1);
}

const city = process.argv[2];
const maxResults = process.argv[3] ? parseInt(process.argv[3]) : 50;

discoverVenuesInCity(city, maxResults).then(() => {
  log(`Venue discovery completed for ${city}`);
  process.exit(0);
}).catch(error => {
  log(`Error: ${error.message}`);
  process.exit(1);
});