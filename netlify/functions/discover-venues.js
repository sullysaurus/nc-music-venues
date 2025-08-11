const fs = require('fs-extra');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');
const puppeteer = require('puppeteer');

// For serverless, we can't persist files between function calls
// This function will discover venues and return them without saving
// The frontend will need to handle displaying and managing the results

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
  
  // For serverless, we just discover new venues without checking existing ones
  const existingVenues = new Set(); // Empty set for now
  
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
  
  console.log(`Discovery complete! Found ${newVenues.length} venues in ${city}`);
  
  return newVenues;
};

exports.handler = async (event, context) => {
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
    
    // Run discovery
    const newVenues = await discoverVenuesInCity(city, Math.min(maxResults, 30)); // Limit for timeout
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        message: `Venue discovery completed for ${city}. Found ${newVenues.length} venues.`,
        venuesFound: newVenues.length,
        venues: newVenues // Return all discovered venues
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