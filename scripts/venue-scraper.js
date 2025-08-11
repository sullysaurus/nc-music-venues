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

// Scrape email from website
async function scrapeVenueEmail(venue, browser) {
  if (!venue.website || venue.contact_email) return null;
  
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
      
      // Extract email
      const email = extractEmail(content + ' ' + text, venue.website);
      
      if (email) {
        log(`Found email for ${venue.name}: ${email}`);
        return email;
      }
      
      // Try contact page if available
      const contactLinks = await page.$$eval('a', links => 
        links.filter(link => 
          /contact|booking|about/i.test(link.textContent) ||
          /contact|booking|about/i.test(link.href)
        ).map(link => link.href)
      );
      
      for (const contactUrl of contactLinks.slice(0, 1)) {
        try {
          await page.goto(contactUrl, { waitUntil: 'domcontentloaded', timeout: 8000 });
          const contactContent = await page.content();
          const contactText = await page.evaluate(() => document.body.innerText || '');
          
          const contactEmail = extractEmail(contactContent + ' ' + contactText, contactUrl);
          if (contactEmail) {
            log(`Found email on contact page for ${venue.name}: ${contactEmail}`);
            return contactEmail;
          }
        } catch (error) {
          // Ignore errors from contact pages
        }
      }
      
      // Success - return null if no email found
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
async function scrapeMissingEmails() {
  log('Starting venue email scraping...');
  
  const venues = loadVenues();
  const venuesWithoutEmail = venues.filter(v => !v.contact_email && v.website);
  
  if (venuesWithoutEmail.length === 0) {
    log('No venues missing emails found');
    return;
  }
  
  log(`Found ${venuesWithoutEmail.length} venues missing emails`);
  
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
    for (let i = 0; i < venuesWithoutEmail.length; i += batchSize) {
      const batch = venuesWithoutEmail.slice(i, i + batchSize);
      const batchNum = Math.floor(i/batchSize) + 1;
      const totalBatches = Math.ceil(venuesWithoutEmail.length/batchSize);
      
      log(`Processing batch ${batchNum} of ${totalBatches} (venues ${i+1}-${Math.min(i+batchSize, venuesWithoutEmail.length)}/${venuesWithoutEmail.length})`);
      
      // Process venues one at a time to avoid browser crashes
      for (const venue of batch) {
        try {
          const email = await scrapeVenueEmail(venue, browser);
          if (email) {
            venue.contact_email = email;
            updatedCount++;
            
            // Save progress after each successful email found
            if (updatedCount % 5 === 0) {
              saveVenues(venues);
              log(`Progress saved: ${updatedCount} emails found so far`);
            }
          }
        } catch (error) {
          log(`Failed to process ${venue.name}: ${error.message}`);
        }
        
        // Small delay between individual venue processing
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // Longer wait between batches to be respectful
      if (i + batchSize < venuesWithoutEmail.length) {
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    
    if (updatedCount > 0) {
      saveVenues(venues);
      log(`Successfully updated ${updatedCount} venues with new emails`);
    } else {
      log('No new emails found in this run');
    }
    
  } catch (error) {
    log(`Critical error in scraping process: ${error.message}`);
  } finally {
    if (browser) await browser.close();
  }
}

// Schedule the scraper
function startScheduledScraping() {
  log('Starting scheduled venue email scraping service...');
  
  // Run every 6 hours
  cron.schedule('0 */6 * * *', () => {
    log('Scheduled scraping triggered');
    scrapeMissingEmails();
  });
  
  // Run immediately on start
  setTimeout(() => {
    scrapeMissingEmails();
  }, 5000);
}

// Manual run mode
if (process.argv.includes('--manual')) {
  scrapeMissingEmails().then(() => {
    log('Manual scraping completed');
    process.exit(0);
  });
} else {
  startScheduledScraping();
}

log('Venue scraper initialized');