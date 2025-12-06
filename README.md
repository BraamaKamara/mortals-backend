# MORTALS Email Verification Service

Backend API for email verification in the MORTALS Dashboard.

## Setup Instructions

### 1. Install Dependencies

```bash
cd server
npm install
```

### 2. Configure Email Service

1. Copy `.env.example` to `.env`:
   ```bash
   copy .env.example .env
   ```

2. Edit `.env` file with your email credentials

### 3. Gmail Setup (Recommended)

If using Gmail:

1. Enable 2-Factor Authentication on your Google account
2. Go to: https://myaccount.google.com/apppasswords
3. Generate an "App Password" for "Mail"
4. Use this app password in your `.env` file (NOT your regular password)

Example `.env` for Gmail:
```
EMAIL_SERVICE=gmail
EMAIL_USER=youremail@gmail.com
EMAIL_PASSWORD=abcd efgh ijkl mnop
```

Alternatively, you can configure a custom SMTP server (overrides EMAIL_SERVICE when SMTP_HOST is set):

```
SMTP_HOST=smtp.yourprovider.com
SMTP_PORT=587
SMTP_SECURE=false   # true for 465
EMAIL_USER=youremail@domain.com
EMAIL_PASSWORD=your-smtp-password-or-app-password
```

### 4. Start the Server

Development mode (auto-restart):
```bash
npm run dev
```

Production mode:
```bash
npm start
```

Server will run on `http://localhost:3001`

## API Endpoints

### POST `/api/send-verification`
Send verification PIN to email
```json
{
  "email": "user@example.com",
  "username": "John Doe"
}
```

### POST `/api/verify-pin`
Verify the PIN code
```json
{
  "email": "user@example.com",
  "pin": "123456"
}
```

### POST `/api/resend-verification`
Resend verification code (rate limited to 1 per minute)
```json
{
  "email": "user@example.com",
  "username": "John Doe"
}
```

### GET `/api/health`
Health check endpoint

## Security Features

- PINs expire after 10 minutes
- Maximum 5 verification attempts per code
- Rate limiting on resend (1 minute cooldown)
- Automatic cleanup of expired codes
- Case-insensitive email matching

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| PORT | Server port | 3001 |
| EMAIL_SERVICE | Email provider (ignored if SMTP_HOST is set) | gmail |
| EMAIL_USER | Your email address | user@gmail.com |
| EMAIL_PASSWORD | App-specific password | abcd efgh ijkl mnop |
| SMTP_HOST | SMTP host (optional) | smtp.gmail.com |
| SMTP_PORT | SMTP port (optional) | 587 |
| SMTP_SECURE | Use TLS (true for 465) | false |

## Troubleshooting

**Error: "EAUTH 535" or "Invalid login"**
- Make sure you're using an App Password, not your regular password
- Enable 2FA on your Google account first
- Ensure EMAIL_USER matches the account the App Password was generated for
- Restart the server after updating `.env`

When running in development, the server will attempt to verify the email transporter on startup and log helpful hints if authentication fails.

**Error: "Connection timeout"**
- Check your internet connection
- Verify EMAIL_SERVICE is correct
- Try using a different email service

**Emails not sending**
- Check spam folder
- Verify EMAIL_USER and EMAIL_PASSWORD are correct
- Make sure less secure apps are NOT enabled (use App Passwords instead)

## Development Notes

- Verification codes are stored in-memory (not persisted)
- Codes expire after 10 minutes
- Maximum 5 attempts per code
- 1 minute cooldown between resend requests
