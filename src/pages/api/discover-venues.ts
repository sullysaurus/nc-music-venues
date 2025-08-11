import type { APIRoute } from 'astro';
import { spawn } from 'child_process';
import path from 'path';

export const POST: APIRoute = async ({ request }) => {
  try {
    const { city, maxResults = 25 } = await request.json();
    
    if (!city || typeof city !== 'string') {
      return new Response('City parameter is required', { status: 400 });
    }
    
    const scriptPath = path.join(process.cwd(), 'scripts/venue-discovery.js');
    
    // Spawn the discovery process
    const child = spawn('node', [scriptPath, city, maxResults.toString()], {
      detached: true,
      stdio: 'ignore'
    });
    
    child.unref(); // Allow parent process to exit independently
    
    return new Response(`Venue discovery started for ${city}. This may take a few minutes.`, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain'
      }
    });
    
  } catch (error) {
    console.error('Error starting venue discovery:', error);
    return new Response(`Error starting venue discovery: ${error.message}`, {
      status: 500,
      headers: {
        'Content-Type': 'text/plain'
      }
    });
  }
};