// MORTALS Dashboard - Email Verification Backend
// Minimal Express server for email verification only

const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2024-06-20' });
const subscriptions = require('./subscriptions');
const authRoutes = require('./routes/auth');
const postsRoutes = require('./routes/posts');
const profileRoutes = require('./routes/profile');
const notificationsRoutes = require('./routes/notifications');
// Temporarily disabled to test
const messagesRoutes = require('./routes/messages');
const bookmarksRoutes = require('./routes/bookmarks');
const moderationRoutes = require('./routes/moderation');
const auth = require('./auth');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
    methods: ['GET', 'POST']
  }
});
const PORT = process.env.PORT || 3001;

// In-memory storage for verification codes (expires after 10 minutes)
const verificationCodes = new Map();

// Middleware
app.use(cors());

// Email transporter configuration (supports service OR custom SMTP)
function createTransporter() {
  const hasCustomSmtp = !!process.env.SMTP_HOST;

  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
    console.warn('\n[Config] EMAIL_USER or EMAIL_PASSWORD missing. Email sending will fail until configured.');
  }

  if (hasCustomSmtp) {
    const secure = String(process.env.SMTP_SECURE || '').toLowerCase();
    const secureBool = secure === 'true' || secure === '1';
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: secureBool,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
      }
    });
  }

  // Default to service-based transport (gmail by default)
  return nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD
    }
  });
}

const transporter = createTransporter();

// Generate 6-digit PIN
function generatePIN() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Clean up expired codes (runs every minute)
setInterval(() => {
  const now = Date.now();
  for (const [email, data] of verificationCodes.entries()) {
    if (now - data.timestamp > 10 * 60 * 1000) { // 10 minutes
      verificationCodes.delete(email);
    }
  }
}, 60000);

// API Routes
// --- Billing: Create Checkout Session ---
app.post('/api/billing/create-checkout-session', async (req, res) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({ error: 'Stripe not configured' });
    }
    const priceId = process.env.STRIPE_PRICE_PRO;
    if (!priceId) return res.status(500).json({ error: 'Price ID missing (STRIPE_PRICE_PRO)' });
    const { email } = req.body || {};
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: email || undefined,
      success_url: process.env.STRIPE_SUCCESS_URL + '&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: process.env.STRIPE_CANCEL_URL,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('[Stripe] create-checkout-session error:', err.message);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// --- Billing Webhook ---
// Use raw body for Stripe signature verification (MUST come before express.json())
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;
  try {
    if (!webhookSecret) throw new Error('Webhook secret missing');
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('[Stripe] Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      console.log('[Stripe] Checkout completed:', session.id);
      subscriptions.setFromCheckout({
        email: session.customer_details?.email || session.metadata?.email || null,
        customerId: session.customer,
        subscriptionId: session.subscription,
        status: 'active'
      });
      break;
    }
    case 'invoice.payment_succeeded': {
      console.log('[Stripe] Payment succeeded');
      break;
    }
    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      console.log('[Stripe] Subscription canceled:', subscription.id);
      subscriptions.cancelByCustomer(subscription.customer);
      break;
    }
    default:
      console.log(`[Stripe] Unhandled event type ${event.type}`);
  }
  res.json({ received: true });
});

// Body parser for the rest of the JSON endpoints (must come AFTER webhook raw parser)
app.use(express.json());

// --- Billing: Create Customer Portal Session ---
app.post('/api/billing/create-portal-session', async (req, res) => {
  try {
    let { customerId, email } = req.body || {};
    console.log('[Portal] Request received:', { customerId, email });
    
    if (!customerId && email) {
      console.log('[Portal] Looking up customer by email:', email);
      const customers = await stripe.customers.list({ email, limit: 1 });
      customerId = customers.data?.[0]?.id;
      console.log('[Portal] Found customerId:', customerId);
    }
    
    if (!customerId) {
      console.log('[Portal] No customerId found, returning 400');
      return res.status(400).json({ error: 'customerId or email required' });
    }
    
    console.log('[Portal] Creating portal session for customer:', customerId);
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: process.env.STRIPE_PORTAL_RETURN_URL || process.env.STRIPE_SUCCESS_URL
    });
    console.log('[Portal] Portal session created:', portalSession.url);
    res.json({ url: portalSession.url });
  } catch (err) {
    console.error('[Stripe] create-portal-session error:', err.message);
    res.status(500).json({ error: 'Failed to create portal session' });
  }
});

// --- Billing: Retrieve Checkout Session (verify success) ---
app.get('/api/billing/session', async (req, res) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) return res.status(500).json({ error: 'Stripe not configured' });
    const sessionId = req.query.session_id || req.query.id;
    if (!sessionId) return res.status(400).json({ error: 'session_id required' });
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['customer', 'subscription']
    });
    const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
    const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
    return res.json({
      id: session.id,
      status: session.status,
      mode: session.mode,
      customerId,
      subscriptionId
    });
  } catch (err) {
    console.error('[Stripe] Retrieve session error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve session' });
  }
});

// --- Entitlement: Fetch current plan by email ---
app.get('/api/entitlement', async (req, res) => {
  try {
    const email = (req.query.email || '').toString().trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'email required' });
    const record = await subscriptions.getByEmail(email);
    if (!record) return res.json({ plan: 'free' });
    return res.json({
      plan: record.plan || 'free',
      status: record.status || null,
      customerId: record.stripe_customer_id || null,
      updatedAt: record.updated_at || null,
    });
  } catch (err) {
    console.error('[Entitlements] Fetch error:', err.message);
    res.status(500).json({ error: 'Failed to fetch entitlement' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'MORTALS Email Verification Service' });
});

// Dev-only: minimal config introspection (no secrets)
app.get('/api/debug-config', (req, res) => {
  const isProd = process.env.NODE_ENV === 'production';
  if (isProd) return res.status(403).json({ error: 'Not available in production' });
  res.json({
    mode: process.env.SMTP_HOST ? 'smtp' : 'service',
    emailService: process.env.EMAIL_SERVICE || 'gmail',
    smtpHost: process.env.SMTP_HOST || null,
    smtpPort: process.env.SMTP_PORT || null,
    smtpSecure: process.env.SMTP_SECURE || null,
    emailUser: process.env.EMAIL_USER ? 'configured' : 'missing',
    emailPassword: process.env.EMAIL_PASSWORD ? 'configured' : 'missing'
  });
});

// Core send verification logic (reused by send/resend)
async function sendVerificationEmail({ email, username }) {
  // Generate PIN
  const pin = generatePIN();

  // Store PIN with timestamp
  verificationCodes.set(email.toLowerCase(), {
    pin,
    timestamp: Date.now(),
    attempts: 0
  });

  const mailOptions = {
    from: `"MORTALS Dashboard" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: 'MORTALS - Email Verification Code',
    html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
            .pin-box { background: white; border: 2px solid #667eea; border-radius: 10px; padding: 20px; text-align: center; margin: 20px 0; }
            .pin { font-size: 36px; font-weight: bold; color: #667eea; letter-spacing: 5px; }
            .warning { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; }
            .footer { text-align: center; color: #6b7280; font-size: 12px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>⏳ MORTALS</h1>
              <p>Email Verification Required</p>
            </div>
            <div class="content">
              <p>Hello <strong>${username || 'Mortal'}</strong>,</p>
              
              <p>Welcome to your mortality awareness journey. To complete your account creation, please verify your email address.</p>
              
              <div class="pin-box">
                <p style="margin: 0; color: #6b7280; font-size: 14px;">Your Verification PIN:</p>
                <div class="pin">${pin}</div>
              </div>
              
              <p>Enter this PIN in the MORTALS dashboard to verify your email address.</p>
              
              <div class="warning">
                <strong>⚠️ Important:</strong> This code expires in 10 minutes. If you didn't request this verification, please ignore this email.
              </div>
              
              <p style="color: #6b7280; font-style: italic;">
                "We are all mortal. The question is: are we awake?"
              </p>
            </div>
            <div class="footer">
              <p>MORTALS Dashboard - A Tool for Mortality Awareness</p>
              <p>This email was sent because someone attempted to create an account with this email address.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    text: `
        MORTALS - Email Verification
        
        Hello ${username || 'Mortal'},
        
        Welcome to your mortality awareness journey. To complete your account creation, please verify your email address.
        
        Your Verification PIN: ${pin}
        
        Enter this PIN in the MORTALS dashboard to verify your email address.
        
        IMPORTANT: This code expires in 10 minutes. If you didn't request this verification, please ignore this email.
        
        "We are all mortal. The question is: are we awake?"
        
        ---
        MORTALS Dashboard - A Tool for Mortality Awareness
      `
  };

  // Send email
  await transporter.sendMail(mailOptions);

  console.log(`Verification PIN sent to ${email}: ${pin}`);

  return { expiresIn: 600 };
}

// Send verification PIN
app.post('/api/send-verification', async (req, res) => {
  try {
    const { email, username } = req.body;

    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email address required' });
    }

    const { expiresIn } = await sendVerificationEmail({ email, username });

    res.json({ 
      success: true, 
      message: 'Verification code sent to your email',
      expiresIn
    });

  } catch (error) {
    console.error('Error sending verification email:', error);
    const isDev = process.env.NODE_ENV !== 'production';
    const diagnostics = isDev ? {
      code: error.code,
      message: error.message,
      hint: (error.code === 'EAUTH' || /invalid login|bad credentials/i.test(error.message))
        ? 'Authentication failed. If using Gmail, ensure 2FA is enabled and use a 16-character App Password for EMAIL_PASSWORD. EMAIL_USER must match the Gmail account.'
        : undefined
    } : undefined;
    res.status(500).json({ 
      error: 'Failed to send verification email. Please try again.',
      details: diagnostics
    });
  }
});

// Verify PIN
app.post('/api/verify-pin', (req, res) => {
  try {
    const { email, pin } = req.body;

    if (!email || !pin) {
      return res.status(400).json({ error: 'Email and PIN required' });
    }

    const emailLower = email.toLowerCase();
    const storedData = verificationCodes.get(emailLower);

    if (!storedData) {
      return res.status(404).json({ error: 'No verification code found. Please request a new one.' });
    }

    // Check expiration (10 minutes)
    const now = Date.now();
    if (now - storedData.timestamp > 10 * 60 * 1000) {
      verificationCodes.delete(emailLower);
      return res.status(410).json({ error: 'Verification code expired. Please request a new one.' });
    }

    // Check attempts (max 5)
    if (storedData.attempts >= 5) {
      verificationCodes.delete(emailLower);
      return res.status(429).json({ error: 'Too many failed attempts. Please request a new code.' });
    }

    // Verify PIN
    if (storedData.pin === pin.toString()) {
      verificationCodes.delete(emailLower);
      return res.json({ 
        success: true, 
        message: 'Email verified successfully!',
        verified: true
      });
    } else {
      // Increment attempts
      storedData.attempts += 1;
      return res.status(401).json({ 
        error: 'Invalid PIN. Please try again.',
        attemptsRemaining: 5 - storedData.attempts
      });
    }

  } catch (error) {
    console.error('Error verifying PIN:', error);
    res.status(500).json({ error: 'Verification failed. Please try again.' });
  }
});

// Resend verification code
app.post('/api/resend-verification', async (req, res) => {
  try {
    const { email, username } = req.body;

    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email address required' });
    }

    // Check if there's a recent code (rate limiting)
    const storedData = verificationCodes.get(email.toLowerCase());
    if (storedData) {
      const timeSinceLastSend = Date.now() - storedData.timestamp;
      if (timeSinceLastSend < 60000) { // 1 minute
        return res.status(429).json({ 
          error: 'Please wait before requesting a new code',
          retryAfter: Math.ceil((60000 - timeSinceLastSend) / 1000)
        });
      }
    }

    // Send a fresh code
    const { expiresIn } = await sendVerificationEmail({ email, username });
    return res.json({
      success: true,
      message: 'A new verification code has been sent',
      expiresIn
    });

  } catch (error) {
    console.error('Error resending verification:', error);
    res.status(500).json({ error: 'Failed to resend verification code' });
  }
});

// --- Auth Routes ---
app.use('/api/auth', authRoutes);

// --- Posts and Comments Routes ---
app.use('/api/posts', postsRoutes);

// --- Profile Routes ---
app.use('/api/profile', profileRoutes);

// --- Notifications Routes ---
app.use('/api/notifications', notificationsRoutes);

// --- Messages Routes ---
// app.use('/api/messages', messagesRoutes);

// --- Bookmarks Routes ---
// app.use('/api/bookmarks', bookmarksRoutes);

// --- Moderation Routes ---
// app.use('/api/moderation', moderationRoutes);

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`[Socket.io] User connected: ${socket.id}`);

  socket.on('authenticate', (token) => {
    // Verify JWT and attach user info to socket
    try {
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
      socket.userId = decoded.id;
      socket.join(`user_${decoded.id}`);
      console.log(`[Socket.io] User ${decoded.id} authenticated`);
    } catch (error) {
      console.error('[Socket.io] Authentication failed:', error.message);
    }
  });

  socket.on('disconnect', () => {
    console.log(`[Socket.io] User disconnected: ${socket.id}`);
  });
});

// Make io available to routes
app.set('io', io);

// Start server with additional diagnostics to catch binding issues on Windows
const HOST = process.env.HOST || '127.0.0.1';
const serverInstance = server.listen(PORT, HOST, () => {
  const addr = serverInstance.address();
  const hostShown = typeof addr === 'string' ? addr : `${addr.address}:${addr.port}`;
  console.log(`\n🔐 MORTALS Email Verification Service`);
  console.log(`📧 Server running on http://${HOST}:${PORT}`);
  console.log(`   Bound address: ${hostShown}`);
  console.log(`✉️  Email service: ${process.env.EMAIL_SERVICE || 'gmail'}`);
  console.log(`👤 Email user: ${process.env.EMAIL_USER || 'NOT CONFIGURED'}`);
  console.log(`🔌 WebSocket enabled for real-time updates`);
  console.log(`\n⏳ Ready to verify mortal email addresses...\n`);
  // Verify transporter on startup in dev to catch credential issues early
  const isDev = process.env.NODE_ENV !== 'production';
  if (isDev) {
    transporter.verify((err, success) => {
      if (err) {
        console.warn('[Email] Transport verification failed:', err.message);
        if (err.code === 'EAUTH') {
          console.warn('[Email] Hint: Check EMAIL_USER and EMAIL_PASSWORD. For Gmail, enable 2FA and use a 16-char App Password.');
        }
      } else {
        console.log('[Email] Transport verified and ready to send.');
      }
    });
  }
});

server.on('error', (err) => {
  console.error('[Server] Failed to start:', err.code || err.message);
  if (err.code === 'EADDRINUSE') {
    console.error(`[Server] Port ${PORT} is already in use. Set a different PORT in server/.env or stop the other process.`);
  }
});

// Extra diagnostics for unexpected shutdowns
process.on('exit', (code) => {
  console.warn(`[Process] Exiting with code ${code}. If this was not intentional, check for earlier errors above.`);
});
process.on('uncaughtException', (err) => {
  console.error('[Process] Uncaught exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Process] Unhandled rejection:', reason);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});
