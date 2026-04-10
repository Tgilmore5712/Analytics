const urls = [
  'https://analytics-nine-phi.vercel.app/api/projects?page=1&pageSize=5',
  'https://analytics-nine-phi.vercel.app/api/scheduling?page=1&pageSize=5',
  'https://analytics-nine-phi.vercel.app/api/gantt-v2/projects',
];

(async () => {
  for (const url of urls) {
    try {
      const response = await fetch(url, { redirect: 'manual' });
      const text = await response.text();
      console.log(JSON.stringify({
        url,
        status: response.status,
        location: response.headers.get('location'),
        bodyPreview: text.slice(0, 300),
      }, null, 2));
    } catch (error) {
      console.log(JSON.stringify({ url, error: String(error) }, null, 2));
    }
  }
})();
