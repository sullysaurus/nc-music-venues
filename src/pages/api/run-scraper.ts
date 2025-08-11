import type { APIRoute } from 'astro';
import { spawn } from 'child_process';
import path from 'path';

export const POST: APIRoute = async ({ request }) => {
  try {
    const scriptPath = path.join(process.cwd(), 'scripts/venue-scraper.js');
    
    // Spawn the scraper process
    const child = spawn('node', [scriptPath, '--manual'], {
      detached: true,
      stdio: 'ignore'
    });
    
    child.unref(); // Allow parent process to exit independently
    
    return new Response('Scraper started successfully', {
      status: 200,
      headers: {
        'Content-Type': 'text/plain'
      }
    });
    
  } catch (error) {
    console.error('Error starting scraper:', error);
    return new Response(`Error starting scraper: ${error.message}`, {
      status: 500,
      headers: {
        'Content-Type': 'text/plain'
      }
    });
  }
};