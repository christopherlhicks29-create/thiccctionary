/**
 * Introspection helper. Asks Buffer's GraphQL API about the
 * input types we need for posting (especially video/Reel support).
 * Run via: node introspect-buffer.js
 */

const BUFFER_GRAPHQL = 'https://api.buffer.com/';

async function introspect(typeName) {
  const query = `
    query I {
      __type(name: "${typeName}") {
        name
        inputFields {
          name
          type {
            name
            kind
            ofType { name kind ofType { name kind } }
          }
        }
      }
    }
  `;
  const res = await fetch(BUFFER_GRAPHQL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.BUFFER_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ query }),
  });
  return res.json();
}

// Introspect all relevant types for video/Reel posting
for (const typeName of [
  'CreatePostInput',
  'AssetsInput',
  'ImageAssetInput',
  'VideoAssetInput',
  'VideoInput',
  'MediaInput',
]) {
  console.log(`\n=== ${typeName} ===`);
  const json = await introspect(typeName);
  console.log(JSON.stringify(json, null, 2));
}
