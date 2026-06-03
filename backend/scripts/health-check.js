import 'dotenv/config';

const apiUrl = process.env.API_URL || `http://localhost:${process.env.PORT || 4000}`;

async function main() {
  const response = await fetch(`${apiUrl}/api/health`);
  const data = await response.json();

  if (!response.ok || !data.ok) {
    console.error('Health check failed:', data);
    process.exit(1);
  }

  console.log('Health check passed:', data.service, data.mode || 'local');
}

main().catch(error => {
  console.error('Health check failed:', error.message);
  process.exit(1);
});
