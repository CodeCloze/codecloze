import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

export async function POST(request: NextRequest) {
  try {
    // Get the raw body for signature verification
    const body = await request.text();
    
    // Get the signature from headers
    const signature = request.headers.get('X-Hub-Signature-256');
    const eventType = request.headers.get('X-GitHub-Event');
    
    // Log the event type
    console.log('GitHub Webhook Event Type:', eventType);
    
    // Verify signature if secret is configured
    const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
    if (webhookSecret) {
      if (!signature) {
        return NextResponse.json(
          { error: 'Missing signature' },
          { status: 401 }
        );
      }
      
      // GitHub sends signature as "sha256=<hash>"
      const expectedSignature = `sha256=${crypto
        .createHmac('sha256', webhookSecret)
        .update(body)
        .digest('hex')}`;
      
      // Use timing-safe comparison to prevent timing attacks
      if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
        return NextResponse.json(
          { error: 'Invalid signature' },
          { status: 401 }
        );
      }
      
      console.log('Signature verified successfully');
    } else {
      console.warn('GITHUB_WEBHOOK_SECRET not set - skipping signature verification');
    }
    
    // Return 200 OK
    return NextResponse.json({ received: true }, { status: 200 });
  } catch (error) {
    console.error('Error processing webhook:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
