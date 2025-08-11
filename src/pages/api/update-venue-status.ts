import type { APIRoute } from 'astro';
import { updateVenueStatus } from '../../lib/discovered-venues';

export const POST: APIRoute = async ({ request }) => {
  try {
    const { name, location, status } = await request.json();
    
    if (!name || !location || !status) {
      return new Response('Missing required parameters', { status: 400 });
    }
    
    if (status !== 'approved' && status !== 'rejected') {
      return new Response('Invalid status. Must be "approved" or "rejected"', { status: 400 });
    }
    
    const success = updateVenueStatus(name, location, status);
    
    if (success) {
      return new Response(`Venue ${status} successfully`, {
        status: 200,
        headers: {
          'Content-Type': 'text/plain'
        }
      });
    } else {
      return new Response('Venue not found', {
        status: 404,
        headers: {
          'Content-Type': 'text/plain'
        }
      });
    }
    
  } catch (error) {
    console.error('Error updating venue status:', error);
    return new Response(`Error updating venue status: ${error.message}`, {
      status: 500,
      headers: {
        'Content-Type': 'text/plain'
      }
    });
  }
};