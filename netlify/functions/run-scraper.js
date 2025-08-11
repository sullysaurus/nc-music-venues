const fs = require('fs-extra');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');
const puppeteer = require('puppeteer');

const CSV_PATH = path.join(process.cwd(), 'src/data/venues_master.csv');
const BACKUP_PATH = path.join(process.cwd(), 'src/data/venues_backup.csv');

// Load venues from CSV
const loadVenues = () => {
  try {
    if (!fs.existsSync(CSV_PATH)) return [];
    const csvContent = fs.readFileSync(CSV_PATH, 'utf8');
    return parse(csvContent, { columns: true, skip_empty_lines: true });
  } catch (error) {
    console.error(`Error loading venues: ${error.message}`);
    return [];
  }
};

// Save venues to CSV
const saveVenues = (venues) => {
  try {
    // Create backup first
    if (fs.existsSync(CSV_PATH)) {
      fs.copyFileSync(CSV_PATH, BACKUP_PATH);
    }
    
    const csvContent = stringify(venues, { header: true });
    fs.writeFileSync(CSV_PATH, csvContent);
    console.log(`Successfully updated ${venues.length} venues`);
  } catch (error) {
    console.error(`Error saving venues: ${error.message}`);
    throw error;
  }
};

// Extract email from website content
const extractEmail = (content, url) => {
  const emailPatterns = [
    /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g,
    /(?:booking|info|contact|events|music)@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi,
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
  
  const emails = Array.from(foundEmails);
  const priorityEmails = emails.filter(email => 
    /^(booking|info|contact|events|music)@/.test(email)
  );
  
  return priorityEmails.length > 0 ? priorityEmails[0] : emails[0] || null;
};

// Extract phone number from website content
const extractPhone = (content, url) => {
  const phonePatterns = [
    /(?:phone|tel|call|contact)[:\s]*(\(\d{3}\)\s*\d{3}[-.\s]*\d{4})/gi,
    /(?:phone|tel|call|contact)[:\s]*(\d{3}[-.\s]*\d{3}[-.\s]*\d{4})/gi,
    /\b(\(\d{3}\)\s*\d{3}[-.\s]*\d{4})\b/g,
    /\b(\d{3}[-.\s]*\d{3}[-.\s]*\d{4})\b/g,
    /tel:([+]?[\d\s\-\(\)\.]+)/gi
  ];
  
  const foundPhones = new Set();
  
  for (const pattern of phonePatterns) {
    const matches = content.match(pattern);
    if (matches) {
      matches.forEach(match => {
        let phone = match.replace(/(?:phone|tel|call|contact)[:\s]*/gi, '').replace(/tel:/gi, '').trim();
        phone = phone.replace(/[^\d\+\(\)\-\.\s]/g, '');
        
        const digits = phone.replace(/\D/g, '');
        
        if (digits.length === 10 || (digits.length === 11 && digits.startsWith('1'))) {
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
};

// Quick scrape function for serverless environment
const quickScrapeVenue = async (venue, browser) => {
  if (!venue.website) return null;
  
  // Skip if venue already has email and phone
  if (venue.contact_email && venue.contact_phone) return null;
  
  let page;
  
  try {
    page = await browser.newPage();
    
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
    await page.setViewport({ width: 1280, height: 720 });
    
    // Disable images and CSS for speed
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (req.resourceType() === 'stylesheet' || req.resourceType() === 'image') {
        req.abort();
      } else {
        req.continue();
      }
    });
    
    await page.goto(venue.website, { 
      waitUntil: 'domcontentloaded', 
      timeout: 8000
    });
    
    const content = await page.content();
    const text = await page.evaluate(() => document.body.innerText || '');
    const fullContent = content + ' ' + text;
    
    const email = !venue.contact_email ? extractEmail(fullContent, venue.website) : null;
    const phone = !venue.contact_phone ? extractPhone(fullContent, venue.website) : null;
    
    if (email || phone) {
      const found = [];
      if (email) found.push(`email: ${email}`);
      if (phone) found.push(`phone: ${phone}`);
      console.log(`Found for ${venue.name}: ${found.join(', ')}`);
      return { email, phone };
    }
    
    return null;
    
  } catch (error) {
    console.log(`Error scraping ${venue.name}: ${error.message}`);
    return null;
  } finally {
    if (page) {
      try {
        await page.close();
      } catch (e) {
        // Ignore close errors
      }
    }
  }
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
    console.log('Starting quick venue scraping...');
    
    const venues = loadVenues();
    const venuesNeedingInfo = venues.filter(v => v.website && (!v.contact_email || !v.contact_phone));
    
    if (venuesNeedingInfo.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({ 
          message: 'No venues need scraping - all have contact info or no websites',
          venuesProcessed: 0
        })
      };
    }
    
    // Limit venues for serverless timeout - process first 10
    const limitedVenues = venuesNeedingInfo.slice(0, 10);
    console.log(`Processing ${limitedVenues.length} venues (limited for serverless)`);
    
    let browser;
    let updatedCount = 0;
    
    try {
      browser = await puppeteer.launch({ 
        headless: 'new',
        args: [
          '--no-sandbox', 
          '--disable-setuid-sandbox',
          '--ignore-certificate-errors',
          '--ignore-ssl-errors',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-features=VizDisplayCompositor'
        ]
      });
      
      for (const venue of limitedVenues) {
        try {
          const result = await quickScrapeVenue(venue, browser);
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
            
            if (updated) {
              updatedCount++;
            }
          }
        } catch (error) {
          console.log(`Failed to process ${venue.name}: ${error.message}`);
        }
        
        // Small delay between venues
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      if (updatedCount > 0) {
        saveVenues(venues);
      }
      
    } finally {
      if (browser) await browser.close();
    }
    
    return {
      statusCode: 200,
      body: JSON.stringify({ 
        message: `Quick scraping completed. Updated ${updatedCount} venues with new contact information.`,
        venuesProcessed: limitedVenues.length,
        venuesUpdated: updatedCount,
        totalVenuesNeedingWork: venuesNeedingInfo.length
      })
    };
    
  } catch (error) {
    console.error('Error in scraper function:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Error running scraper',
        message: error.message 
      })
    };
  }
};