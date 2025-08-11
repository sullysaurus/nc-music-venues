# Music Venues Directory

A modern, searchable directory of music venues built with Astro and automated contact information scraping.

## Features

- 🎵 **253+ Music Venues** from North Carolina
- 🔍 **Real-time Search & Filtering** by name, location, genre, and venue type
- 📧 **Automated Email Scraping** to continuously fill missing contact information
- 📱 **Responsive Design** that works on all devices
- ⚡ **Fast Performance** with Astro's static site generation
- 📊 **Admin Dashboard** to monitor data quality and scraping progress

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Visit the app at http://localhost:4321/
# Visit admin dashboard at http://localhost:4321/admin
```

## Automated Contact Scraping

The app includes a powerful scraping system that automatically finds missing contact emails:

### Manual Scraping Commands

```bash
# Run scraper once manually
npm run scrape

# Start scraper with scheduled runs (every 6 hours)
npm run scrape:watch

# Run scraper in background (detached process)
npm run scrape:background
```

### How It Works

1. **Identifies Missing Emails**: Finds venues without contact_email but with websites
2. **Batch Processing**: Processes 5 venues at a time to be respectful to servers
3. **Smart Email Detection**: Uses multiple patterns to find booking, info, and contact emails
4. **Contact Page Discovery**: Automatically searches contact pages for additional emails
5. **Auto-Backup**: Creates backup of data before making changes
6. **Detailed Logging**: Tracks all scraping activity in `logs/scraper.log`

### Monitoring Progress

- Visit `/admin` to see real-time statistics and scraping progress
- View logs in the admin dashboard
- Manual trigger scraping from the admin interface
- Auto-refresh dashboard every 30 seconds

## Data Structure

The venue data includes:

- **Basic Info**: Name, location, address, venue type
- **Contact**: Email, phone, website
- **Details**: Capacity, genres, booking fees, notes
- **Metadata**: Verification status, creation date

## File Structure

```
src/
├── data/
│   ├── venues_master.csv     # Main venue data
│   └── venues_backup.csv     # Auto-backup
├── lib/
│   ├── venues.ts            # Data loading utilities
│   └── venue-watcher.ts     # Hot-reload system
├── pages/
│   ├── index.astro          # Main directory page
│   ├── admin.astro          # Admin dashboard
│   └── api/
│       └── run-scraper.ts   # API endpoint for manual scraping
scripts/
├── venue-scraper.js         # Main scraping engine
logs/
├── scraper.log              # Detailed scraping logs
└── scraper-background.log   # Background process logs
```

## Scraping Configuration

The scraper is configured to:

- Run every 6 hours when in watch mode
- Process venues in batches of 5 (configurable)
- Wait 3 seconds between batches
- Prioritize booking/info/contact emails over generic ones
- Create automatic backups before updating data
- Skip venues that already have emails
- Handle SSL certificate errors gracefully

## Customization

### Adding New Venue Sources

Add new venue data by:
1. Updating `venues_master.csv` with new entries
2. The scraper will automatically find missing emails on next run

### Modifying Scraping Behavior

Edit `scripts/venue-scraper.js` to:
- Change batch sizes
- Modify email detection patterns
- Adjust scraping intervals
- Add custom website handlers

### Styling

All styles are in the Astro files using scoped CSS. The design uses:
- System fonts for performance
- Tailwind-inspired color palette
- Mobile-first responsive design
- Subtle animations and hover effects

## Production Deployment

```bash
# Build for production
npm run build

# Start background scraper (recommended for production)
npm run scrape:background
```

## Logs and Monitoring

- **Scraper logs**: `logs/scraper.log`
- **Background logs**: `logs/scraper-background.log`
- **Admin dashboard**: Real-time statistics at `/admin`

## Current Status

- ✅ **15 venues** with existing emails
- 🔄 **238 venues** being scraped for missing emails
- 📊 **6.3%** completion rate and growing
- 🤖 **Automated scraping** running continuously

The scraper is actively working to fill missing contact information and will continue running in the background to keep the directory updated!
