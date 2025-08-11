#!/usr/bin/env node

import fs from 'fs-extra';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import puppeteer from 'puppeteer';
import cron from 'node-cron';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.join(__dirname, '../src/data/venues_master.csv');
const BACKUP_PATH = path.join(__dirname, '../src/data/venues_backup.csv');
const LOG_PATH = path.join(__dirname, '../logs/scraper.log');

// Ensure logs directory exists
await fs.ensureDir(path.dirname(LOG_PATH));

// Logging function
function log(message) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}\n`;
  console.log(logEntry.trim());
  fs.appendFileSync(LOG_PATH, logEntry);
}

// Load venues from CSV
function loadVenues() {
  try {
    const csvContent = fs.readFileSync(CSV_PATH, 'utf8');
    return parse(csvContent, { columns: true, skip_empty_lines: true });
  } catch (error) {
    log(`Error loading venues: ${error.message}`);
    return [];
  }
}

// Save venues to CSV
function saveVenues(venues) {
  try {
    // Create backup first
    fs.copyFileSync(CSV_PATH, BACKUP_PATH);
    
    const csvContent = stringify(venues, { header: true });
    fs.writeFileSync(CSV_PATH, csvContent);
    log(`Successfully updated ${venues.length} venues`);
  } catch (error) {
    log(`Error saving venues: ${error.message}`);
  }
}

// Extract email from website content
function extractEmail(content, url) {
  const emailPatterns = [
    // Standard email patterns
    /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g,
    // Common booking/info emails
    /(?:booking|info|contact|events|music)@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi,
    // mailto: links
    /mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi
  ];
  
  const foundEmails = new Set();
  
  for (const pattern of emailPatterns) {
    const matches = content.match(pattern);
    if (matches) {
      matches.forEach(match => {
        const email = match.replace(/mailto:/i, '').trim();
        if (email.includes('@') && !email.includes('noreply') && !email.includes('example')) {
          foundEmails.add(email.toLowerCase());
        }
      });
    }
  }
  
  // Prioritize booking/info/contact emails
  const emails = Array.from(foundEmails);
  const priorityEmails = emails.filter(email => 
    /^(booking|info|contact|events|music)@/.test(email)
  );
  
  return priorityEmails.length > 0 ? priorityEmails[0] : emails[0] || null;
}

// Extract phone number from website content
function extractPhone(content, url) {
  const phonePatterns = [
    // Standard US phone patterns
    /(?:phone|tel|call|contact)[:\s]*(\(\d{3}\)\s*\d{3}[-.\s]*\d{4})/gi,
    /(?:phone|tel|call|contact)[:\s]*(\d{3}[-.\s]*\d{3}[-.\s]*\d{4})/gi,
    // Standalone phone patterns
    /\b(\(\d{3}\)\s*\d{3}[-.\s]*\d{4})\b/g,
    /\b(\d{3}[-.\s]*\d{3}[-.\s]*\d{4})\b/g,
    // tel: links
    /tel:([+]?[\d\s\-\(\)\.]+)/gi,
    // International formats
    /\b(\+1[-.\s]*\d{3}[-.\s]*\d{3}[-.\s]*\d{4})\b/g
  ];
  
  const foundPhones = new Set();
  
  for (const pattern of phonePatterns) {
    const matches = content.match(pattern);
    if (matches) {
      matches.forEach(match => {
        let phone = match.replace(/(?:phone|tel|call|contact)[:\s]*/gi, '').replace(/tel:/gi, '').trim();
        
        // Clean and format phone number
        phone = phone.replace(/[^\d\+\(\)\-\.\s]/g, '');
        
        // Extract just digits for validation
        const digits = phone.replace(/\D/g, '');
        
        // Validate US phone numbers (10 or 11 digits)
        if (digits.length === 10 || (digits.length === 11 && digits.startsWith('1'))) {
          // Format consistently
          let formattedPhone;
          if (digits.length === 11) {
            formattedPhone = `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
          } else {
            formattedPhone = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
          }
          foundPhones.add(formattedPhone);
        }
      });
    }
  }
  
  const phones = Array.from(foundPhones);
  return phones.length > 0 ? phones[0] : null;
}

// Extract capacity from website content
function extractCapacity(content, url) {
  const capacityPatterns = [
    // Direct capacity mentions
    /(?:capacity|seating|seats?|holds?)[:\s]*(\d{1,5})/gi,
    /(\d{1,5})[:\s]*(?:capacity|person|people|guests?|seat|seating)/gi,
    // Venue size descriptions
    /(?:accommodates?|fits?|holds?)[:\s]*(?:up\s*to\s*)?(\d{1,5})/gi,
    /(?:maximum|max)[:\s]*(?:capacity|occupancy|seating)[:\s]*(\d{1,5})/gi,
    // Standing room / concert capacity
    /(?:standing)[:\s]*(\d{1,5})/gi,
    /(?:concert|show|event)[:\s]*capacity[:\s]*(\d{1,5})/gi,
    // General occupancy
    /(?:occupancy|maximum)[:\s]*(\d{1,5})/gi
  ];
  
  const foundCapacities = new Set();
  
  for (const pattern of capacityPatterns) {
    const matches = content.match(pattern);
    if (matches) {
      matches.forEach(match => {
        // Extract the number from the match
        const numbers = match.match(/\d{1,5}/g);
        if (numbers) {
          numbers.forEach(num => {
            const capacity = parseInt(num, 10);
            // Filter reasonable venue capacities (50-100,000)
            if (capacity >= 50 && capacity <= 100000) {
              foundCapacities.add(capacity);
            }
          });
        }
      });
    }
  }
  
  if (foundCapacities.size === 0) return null;
  
  // If multiple capacities found, prefer the largest reasonable one
  const capacities = Array.from(foundCapacities).sort((a, b) => b - a);
  
  // Filter out obviously wrong capacities (like years, phone numbers, etc.)
  const reasonableCapacities = capacities.filter(cap => {
    // Exclude numbers that look like years (2020-2030)
    if (cap >= 2020 && cap <= 2030) return false;
    // Exclude very specific numbers that might be phone/address fragments
    if (cap.toString().length === 4 && cap > 3000) return false;
    return true;
  });
  
  return reasonableCapacities.length > 0 ? reasonableCapacities[0] : null;
}

// Extract genres from website content
function extractGenres(content, url) {
  const genreKeywords = [
    // Main genres
    'rock', 'pop', 'jazz', 'blues', 'country', 'folk', 'indie', 'alternative', 
    'metal', 'punk', 'electronic', 'hip hop', 'rap', 'reggae', 'funk', 'soul',
    'r&b', 'classical', 'acoustic', 'bluegrass', 'americana', 'gospel', 'christian',
    
    // Sub-genres and styles
    'hard rock', 'soft rock', 'classic rock', 'indie rock', 'alt rock',
    'death metal', 'black metal', 'heavy metal', 'thrash metal',
    'house music', 'techno', 'dubstep', 'edm', 'dance music',
    'old time', 'oldtime', 'traditional', 'roots music', 'world music',
    'singer songwriter', 'singer-songwriter',
    
    // Descriptive terms
    'live music', 'all genres', 'variety', 'eclectic', 'diverse',
    'touring acts', 'local bands', 'original music', 'cover bands'
  ];
  
  const foundGenres = new Set();
  const lowerContent = content.toLowerCase();
  
  // Look for genre keywords in content
  for (const genre of genreKeywords) {
    const regex = new RegExp(`\\b${genre.replace(/[.*+?^${}()|[\]\\\\]/g, '\\\\$&')}\\b`, 'gi');
    if (regex.test(lowerContent)) {
      // Capitalize first letter of each word
      const formattedGenre = genre.split(' ').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      ).join(' ');
      foundGenres.add(formattedGenre);
    }
  }
  
  // Look for music-related phrases that might indicate genres
  const genrePatterns = [
    /music[:\s]*([^.;!?\\n]{1,100})/gi,
    /genres?[:\s]*([^.;!?\\n]{1,100})/gi,
    /style[s]?[:\s]*([^.;!?\\n]{1,100})/gi,
    /featuring[:\s]*([^.;!?\\n]{1,100})/gi
  ];
  
  for (const pattern of genrePatterns) {
    const matches = content.match(pattern);
    if (matches) {
      matches.forEach(match => {
        const text = match.toLowerCase();
        // Extract genres from the matched text
        for (const genre of genreKeywords) {
          if (text.includes(genre)) {
            const formattedGenre = genre.split(' ').map(word => 
              word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
            ).join(' ');
            foundGenres.add(formattedGenre);
          }
        }
      });
    }
  }
  
  if (foundGenres.size === 0) return null;
  
  // Convert to array and sort
  const genres = Array.from(foundGenres).sort();
  
  // Limit to reasonable number and join with semicolons
  const maxGenres = 8;
  const limitedGenres = genres.slice(0, maxGenres);
  
  return limitedGenres.join('; ');
}

// Scrape venue information from website
async function scrapeVenueInfo(venue, browser) {
  if (!venue.website) return null;
  
  // Skip if venue already has all info
  if (venue.contact_email && venue.contact_phone && venue.capacity && venue.typical_genres) return null;
  
  let page;
  let retries = 0;
  const maxRetries = 2;
  
  while (retries <= maxRetries) {
    try {
      page = await browser.newPage();
      
      // Set user agent and other headers
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
      await page.setViewport({ width: 1280, height: 720 });
      
      // Disable images and CSS to speed up loading
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (req.resourceType() === 'stylesheet' || req.resourceType() === 'image') {
          req.abort();
        } else {
          req.continue();
        }
      });
      
      // Navigate to website with shorter timeout and ignore SSL errors
      await page.goto(venue.website, { 
        waitUntil: 'domcontentloaded', 
        timeout: 10000
      });
      
      // Get page content
      const content = await page.content();
      const text = await page.evaluate(() => document.body.innerText || '');
      const fullContent = content + ' ' + text;
      
      // Extract email, phone, capacity, and genres
      const email = !venue.contact_email ? extractEmail(fullContent, venue.website) : null;
      const phone = !venue.contact_phone ? extractPhone(fullContent, venue.website) : null;
      const capacity = !venue.capacity ? extractCapacity(fullContent, venue.website) : null;
      const genres = !venue.typical_genres ? extractGenres(fullContent, venue.website) : null;
      
      if (email || phone || capacity || genres) {
        const found = [];
        if (email) found.push(`email: ${email}`);
        if (phone) found.push(`phone: ${phone}`);
        if (capacity) found.push(`capacity: ${capacity}`);
        if (genres) found.push(`genres: ${genres}`);
        log(`Found for ${venue.name}: ${found.join(', ')}`);
        return { email, phone, capacity, genres };
      }
      
      // Try contact page if available (only if we're still missing some info)
      if (!email || !phone || !capacity || !genres) {
        const contactLinks = await page.$$eval('a', links => 
          links.filter(link => 
            /contact|booking|about|info/i.test(link.textContent) ||
            /contact|booking|about|info/i.test(link.href)
          ).map(link => link.href)
        );
        
        for (const contactUrl of contactLinks.slice(0, 1)) {
          try {
            await page.goto(contactUrl, { waitUntil: 'domcontentloaded', timeout: 8000 });
            const contactContent = await page.content();
            const contactText = await page.evaluate(() => document.body.innerText || '');
            const contactFullContent = contactContent + ' ' + contactText;
            
            const contactEmail = !email && !venue.contact_email ? extractEmail(contactFullContent, contactUrl) : null;
            const contactPhone = !phone && !venue.contact_phone ? extractPhone(contactFullContent, contactUrl) : null;
            const contactCapacity = !capacity && !venue.capacity ? extractCapacity(contactFullContent, contactUrl) : null;
            const contactGenres = !genres && !venue.typical_genres ? extractGenres(contactFullContent, contactUrl) : null;
            
            if (contactEmail || contactPhone || contactCapacity || contactGenres) {
              const found = [];
              if (contactEmail) found.push(`email: ${contactEmail}`);
              if (contactPhone) found.push(`phone: ${contactPhone}`);
              if (contactCapacity) found.push(`capacity: ${contactCapacity}`);
              if (contactGenres) found.push(`genres: ${contactGenres}`);
              log(`Found on contact page for ${venue.name}: ${found.join(', ')}`);
              return { 
                email: email || contactEmail, 
                phone: phone || contactPhone,
                capacity: capacity || contactCapacity,
                genres: genres || contactGenres
              };
            }
          } catch (error) {
            // Ignore errors from contact pages
          }
        }
      }
      
      // Return what we found (if anything)
      if (email || phone || capacity || genres) {
        return { email, phone, capacity, genres };
      }
      
      return null;
      
    } catch (error) {
      retries++;
      log(`Error scraping ${venue.name} (attempt ${retries}): ${error.message}`);
      
      if (retries > maxRetries) {
        return null;
      }
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 1000));
    } finally {
      if (page) {
        try {
          await page.close();
        } catch (e) {
          // Ignore close errors
        }
        page = null;
      }
    }
  }
  
  return null;
}

// Main scraping function
async function scrapeMissingInfo() {
  log('Starting venue information scraping...');
  
  const venues = loadVenues();
  const venuesNeedingInfo = venues.filter(v => v.website && (!v.contact_email || !v.contact_phone || !v.capacity || !v.typical_genres));
  
  if (venuesNeedingInfo.length === 0) {
    log('No venues missing information found');
    return;
  }
  
  log(`Found ${venuesNeedingInfo.length} venues missing information (email, phone, capacity, or genres)`);
  
  let browser;
  try {
    browser = await puppeteer.launch({ 
      headless: 'new',
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--ignore-certificate-errors',
        '--ignore-ssl-errors',
        '--ignore-certificate-errors-spki-list',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--disable-default-apps',
        '--disable-features=VizDisplayCompositor'
      ]
    });
    
    let updatedCount = 0;
    const batchSize = 3; // Reduce batch size for better stability
    
    // Process venues in smaller batches to avoid overwhelming servers
    for (let i = 0; i < venuesNeedingInfo.length; i += batchSize) {
      const batch = venuesNeedingInfo.slice(i, i + batchSize);
      const batchNum = Math.floor(i/batchSize) + 1;
      const totalBatches = Math.ceil(venuesNeedingInfo.length/batchSize);
      
      log(`Processing batch ${batchNum} of ${totalBatches} (venues ${i+1}-${Math.min(i+batchSize, venuesNeedingInfo.length)}/${venuesNeedingInfo.length})`);
      
      // Process venues one at a time to avoid browser crashes
      for (const venue of batch) {
        try {
          const result = await scrapeVenueInfo(venue, browser);
          if (result) {
            let updated = false;
            
            if (result.email && !venue.contact_email) {
              venue.contact_email = result.email;
              updated = true;
            }
            
            if (result.phone && !venue.contact_phone) {
              venue.contact_phone = result.phone;
              updated = true;
            }
            
            if (result.capacity && !venue.capacity) {
              venue.capacity = result.capacity;
              updated = true;
            }
            
            if (result.genres && !venue.typical_genres) {
              venue.typical_genres = result.genres;
              updated = true;
            }
            
            if (updated) {
              updatedCount++;
              
              // Save progress after each successful update
              if (updatedCount % 5 === 0) {
                saveVenues(venues);
                log(`Progress saved: ${updatedCount} venues updated so far`);
              }
            }
          }
        } catch (error) {
          log(`Failed to process ${venue.name}: ${error.message}`);
        }
        
        // Small delay between individual venue processing
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // Longer wait between batches to be respectful
      if (i + batchSize < venuesNeedingInfo.length) {
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    
    if (updatedCount > 0) {
      saveVenues(venues);
      log(`Successfully updated ${updatedCount} venues with new contact information`);
    } else {
      log('No new contact information found in this run');
    }
    
  } catch (error) {
    log(`Critical error in scraping process: ${error.message}`);
  } finally {
    if (browser) await browser.close();
  }
}

// Schedule the scraper
function startScheduledScraping() {
  log('Starting scheduled venue information scraping service...');
  
  // Run every 6 hours
  cron.schedule('0 */6 * * *', () => {
    log('Scheduled scraping triggered');
    scrapeMissingInfo();
  });
  
  // Run immediately on start
  setTimeout(() => {
    scrapeMissingInfo();
  }, 5000);
}

// Manual run mode
if (process.argv.includes('--manual')) {
  scrapeMissingInfo().then(() => {
    log('Manual scraping completed');
    process.exit(0);
  });
} else {
  startScheduledScraping();
}

log('Venue scraper initialized');