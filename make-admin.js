const db = require('./db');

async function makeAdmin() {
  const username = 'Ibrahim'; // Change this if needed
  
  try {
    const result = await db.query(
      'UPDATE users SET is_admin = true WHERE username = $1 RETURNING id, username, email, is_admin',
      [username]
    );
    
    if (result.rows.length === 0) {
      console.log(`❌ User '${username}' not found`);
    } else {
      console.log('✅ Admin status granted:');
      console.log(result.rows[0]);
    }
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    process.exit();
  }
}

makeAdmin();
