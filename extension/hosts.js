// Where the extension runs without asking: the app on the reviewer's machine.
export const HOSTS = [
  'http://localhost/*', 'https://localhost/*',
  'http://*.localhost/*', 'https://*.localhost/*',
  'http://127.0.0.1/*', 'https://127.0.0.1/*'
]

// Match patterns take no port: "http://myapp.test:8000" asks for "http://myapp.test/*".
export function originPattern (url) {
  const { protocol, hostname } = new URL(url)
  return `${protocol}//${hostname}/*`
}
