const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'mortals_dashboard',
  user: 'postgres',
  password: 'Surake305'
});

pool.query('SELECT id, username, email, created_at FROM users ORDER BY created_at')
  .then(result => {
    console.log('\n=== Users in Database ===');
    console.log(`Total: ${result.rows.length}\n`);
    result.rows.forEach((user, idx) => {
      console.log(`${idx + 1}. ${user.username}`);
      console.log(`   Email: ${user.email}`);
      console.log(`   ID: ${user.id}`);
      console.log(`   Joined: ${new Date(user.created_at).toLocaleDateString()}\n`);
    });
    pool.end();
  })
  .catch(err => {
    console.error('Error:', err.message);
    pool.end();
  });
